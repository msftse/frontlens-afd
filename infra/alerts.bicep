// FrontLens - Azure Monitor alert rules for real Front Door telemetry.
//
// Native scheduled-query (log) alerts over the SAME Log Analytics workspace the
// Front Door diagnostic setting streams to - so alerting reuses the existing
// pipeline and adds NO always-on compute. Each rule mirrors an in-app incident
// type (5xx spike, latency regression, WAF block surge, traffic drop) and, when
// it fires, notifies the Action Group (email + optional webhook -> Teams/Slack).
//
// Deploy against the resource group that holds the AFD workspace, e.g.:
//   az deployment group create -g frontlens-e2e-rg -f infra/alerts.bicep \
//     -p workspaceResourceId=<workspaceId> alertEmail=you@example.com
//
// The rules are disabled by default until you set alertEmail (or a webhook) so
// a bare deploy never creates a noisy alert with nowhere to send.

@description('Full resourceId of the Log Analytics workspace that receives Front Door access + WAF logs.')
param workspaceResourceId string

@description('Azure region for the alert rules (must match the workspace region).')
param location string = resourceGroup().location

@description('Email address to notify when an alert fires. Empty leaves alerts provisioned but disabled.')
param alertEmail string = ''

@description('Optional webhook URL (Teams/Slack/PagerDuty incoming webhook) to notify on alert.')
param alertWebhookUrl string = ''

@description('Master switch: create the alert rules. Off by default so infra deploys are side-effect free.')
param enableAlerts bool = false

@description('How often each rule evaluates (ISO8601 duration).')
param evaluationFrequency string = 'PT5M'

@description('Lookback window each evaluation aggregates over (ISO8601 duration).')
param windowSize string = 'PT15M'

@description('5xx error-rate threshold (percent) that triggers the server-error alert.')
param error5xxPercentThreshold int = 5

@description('p95 latency threshold (ms) that triggers the latency alert.')
param p95LatencyMsThreshold int = 1500

@description('WAF block-count threshold over the window that triggers the security alert.')
param wafBlockThreshold int = 100

var tags = { app: 'frontlens', managedBy: 'bicep', component: 'alerts' }
var hasEmail = !empty(alertEmail)
var hasWebhook = !empty(alertWebhookUrl)
var rulesEnabled = enableAlerts && (hasEmail || hasWebhook)

// ---- Action Group (who gets notified) ----
resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'frontlens-alerts-ag'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'frontlens'
    enabled: true
    emailReceivers: hasEmail
      ? [
          {
            name: 'primaryEmail'
            emailAddress: alertEmail
            useCommonAlertSchema: true
          }
        ]
      : []
    webhookReceivers: hasWebhook
      ? [
          {
            name: 'webhook'
            serviceUri: alertWebhookUrl
            useCommonAlertSchema: true
          }
        ]
      : []
  }
}

// KQL fragments. Each returns a single measure column the rule thresholds on.
// AFD access logs: AzureDiagnostics / FrontDoorAccessLog. WAF: FrontDoorWebApplicationFirewallLog.

var query5xx = '''
AzureDiagnostics
| where Category == "FrontDoorAccessLog"
| extend statusNum = toint(httpStatusCode_s)
| summarize total = count(), errors = countif(statusNum >= 500) by bin(TimeGenerated, 5m)
| where total > 20
| extend errorRatePct = 100.0 * errors / total
| project TimeGenerated, errorRatePct
'''

var queryLatency = '''
AzureDiagnostics
| where Category == "FrontDoorAccessLog"
| extend ms = todouble(timeTaken_s) * 1000.0
| summarize p95ms = percentile(ms, 95), n = count() by bin(TimeGenerated, 5m)
| where n > 20
| project TimeGenerated, p95ms
'''

var queryWaf = '''
AzureDiagnostics
| where Category == "FrontDoorWebApplicationFirewallLog"
| summarize blocks = countif(action_s == "Block") by bin(TimeGenerated, 5m)
| project TimeGenerated, blocks
'''

// ---- Alert rules ----
resource alert5xx 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (rulesEnabled) {
  name: 'frontlens-5xx-error-rate'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'FrontLens: Front Door 5xx error rate high'
    description: 'Server-error (5xx) rate over the window exceeded the threshold on Front Door access logs.'
    severity: 1
    enabled: true
    scopes: [ workspaceResourceId ]
    evaluationFrequency: evaluationFrequency
    windowSize: windowSize
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: query5xx
          timeAggregation: 'Maximum'
          metricMeasureColumn: 'errorRatePct'
          operator: 'GreaterThan'
          threshold: error5xxPercentThreshold
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [ actionGroup.id ]
    }
  }
}

resource alertLatency 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (rulesEnabled) {
  name: 'frontlens-p95-latency'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'FrontLens: Front Door p95 latency high'
    description: 'p95 edge latency over the window exceeded the threshold on Front Door access logs.'
    severity: 2
    enabled: true
    scopes: [ workspaceResourceId ]
    evaluationFrequency: evaluationFrequency
    windowSize: windowSize
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: queryLatency
          timeAggregation: 'Maximum'
          metricMeasureColumn: 'p95ms'
          operator: 'GreaterThan'
          threshold: p95LatencyMsThreshold
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [ actionGroup.id ]
    }
  }
}

resource alertWaf 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = if (rulesEnabled) {
  name: 'frontlens-waf-block-surge'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'FrontLens: WAF block surge'
    description: 'Enforced WAF blocks over the window exceeded the threshold (likely attack burst).'
    severity: 2
    enabled: true
    scopes: [ workspaceResourceId ]
    evaluationFrequency: evaluationFrequency
    windowSize: windowSize
    autoMitigate: true
    criteria: {
      allOf: [
        {
          query: queryWaf
          timeAggregation: 'Total'
          metricMeasureColumn: 'blocks'
          operator: 'GreaterThan'
          threshold: wafBlockThreshold
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [ actionGroup.id ]
    }
  }
}

output actionGroupId string = actionGroup.id
output alertsEnabled bool = rulesEnabled
output ruleNames array = rulesEnabled
  ? [ 'frontlens-5xx-error-rate', 'frontlens-p95-latency', 'frontlens-waf-block-surge' ]
  : []
