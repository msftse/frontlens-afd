// FrontLens — self-contained END-TO-END test: a Premium-scale Azure Front Door
// fronting a live origin, with access/WAF logs streamed to Log Analytics and
// Event Hubs (the same ingestion transport the production pipeline consumes).
//
// Deploy:
//   az group create -n frontlens-e2e-rg -l eastus2
//   az deployment group create -g frontlens-e2e-rg -f infra/afd-e2e.bicep
//
// Tear down (removes ALL cost):
//   az group delete -n frontlens-e2e-rg --yes --no-wait
//
// Provisions: Log Analytics, a Container Apps environment + a tiny "hello"
// Container App used as the AFD origin, an Azure Front Door PREMIUM profile
// (endpoint + origin group + origin + route), a Premium WAF policy with managed
// rule sets, and a diagnostic setting fanning FrontDoor logs to Log Analytics.
// Set enableEventHub=true to ALSO provision an Event Hubs namespace + hub and
// stream the logs there (the Phase-2 ClickHouse/Kafka ingestion transport).

@description('Azure region for the regional resources (Log Analytics, Event Hubs, Container Apps). Front Door itself is global.')
param location string = resourceGroup().location

@description('Short, lowercase prefix for resource names.')
param namePrefix string = 'afde2e'

@description('Public container image used as the Front Door origin. Must serve HTTP 200 on port 80.')
param originImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Provision the Event Hubs namespace + diagnostic stream (the Phase-2 ClickHouse/Kafka transport). Off by default: the dashboard Live mode reads Log Analytics, not Event Hubs, so this is pure cost when unused.')
param enableEventHub bool = false

@description('Daily ingestion cap (GB) for the Log Analytics workspace, bounding AFD log cost. Use -1 for no cap.')
param logAnalyticsDailyCapGb int = 1

var suffix = uniqueString(resourceGroup().id)
var tags = { app: 'frontlens', scenario: 'afd-e2e', managedBy: 'bicep' }

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: logAnalyticsDailyCapGb }
  }
}

// ---------------------------------------------------------------------------
// Event Hubs — Front Door diagnostic stream (Kafka-compatible for ClickHouse).
// Optional (enableEventHub): only needed to exercise the Phase-2 ClickHouse/
// Kafka ingestion path. The dashboard's Live mode reads Log Analytics instead.
// ---------------------------------------------------------------------------
resource ehNamespace 'Microsoft.EventHub/namespaces@2024-01-01' = if (enableEventHub) {
  name: '${namePrefix}-ehns-${suffix}'
  location: location
  tags: tags
  sku: { name: 'Standard', tier: 'Standard', capacity: 1 }
  properties: { kafkaEnabled: true }
}

resource eventHub 'Microsoft.EventHub/namespaces/eventhubs@2024-01-01' = if (enableEventHub) {
  parent: ehNamespace
  name: 'afd-access-logs'
  properties: {
    partitionCount: 4
    messageRetentionInDays: 1
  }
}

// Diagnostic settings stream to Event Hub via a namespace-scoped rule that can
// Manage/Send/Listen.
resource ehDiagRule 'Microsoft.EventHub/namespaces/authorizationRules@2024-01-01' = if (enableEventHub) {
  parent: ehNamespace
  name: 'diagnostics'
  properties: { rights: [ 'Listen', 'Send', 'Manage' ] }
}

// ---------------------------------------------------------------------------
// Origin — a tiny public "hello world" Container App behind HTTPS ingress.
// ---------------------------------------------------------------------------
resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource originApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-origin'
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: caEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 80
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'origin'
          image: originImage
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

// ---------------------------------------------------------------------------
// WAF policy (Premium tier — enables Microsoft-managed rule sets).
// ---------------------------------------------------------------------------
resource waf 'Microsoft.Network/FrontDoorWebApplicationFirewallPolicies@2024-02-01' = {
  name: '${namePrefix}waf${suffix}'
  location: 'Global'
  sku: { name: 'Premium_AzureFrontDoor' }
  properties: {
    policySettings: {
      enabledState: 'Enabled'
      mode: 'Prevention'
    }
    managedRules: {
      managedRuleSets: [
        {
          ruleSetType: 'Microsoft_DefaultRuleSet'
          ruleSetVersion: '2.1'
          ruleSetAction: 'Block'
        }
        {
          ruleSetType: 'Microsoft_BotManagerRuleSet'
          ruleSetVersion: '1.0'
        }
      ]
    }
  }
}

// ---------------------------------------------------------------------------
// Azure Front Door — PREMIUM profile.
// ---------------------------------------------------------------------------
resource profile 'Microsoft.Cdn/profiles@2024-02-01' = {
  name: '${namePrefix}-afd'
  location: 'Global'
  tags: tags
  sku: { name: 'Premium_AzureFrontDoor' }
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = {
  parent: profile
  name: '${namePrefix}-ep-${suffix}'
  location: 'Global'
  properties: { enabledState: 'Enabled' }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = {
  parent: profile
  name: 'origin-group'
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/'
      probeRequestType: 'HEAD'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 100
    }
    sessionAffinityState: 'Disabled'
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = {
  parent: originGroup
  name: 'origin-app'
  properties: {
    hostName: originApp.properties.configuration.ingress.fqdn
    httpPort: 80
    httpsPort: 443
    originHostHeader: originApp.properties.configuration.ingress.fqdn
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    enforceCertificateNameCheck: true
  }
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: endpoint
  name: 'default-route'
  dependsOn: [ origin ]
  properties: {
    originGroup: { id: originGroup.id }
    supportedProtocols: [ 'Http', 'Https' ]
    patternsToMatch: [ '/*' ]
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
    cacheConfiguration: {
      queryStringCachingBehavior: 'IgnoreQueryString'
      compressionSettings: {
        isCompressionEnabled: true
        contentTypesToCompress: [
          'text/html'
          'text/css'
          'application/javascript'
          'application/json'
        ]
      }
    }
  }
}

resource securityPolicy 'Microsoft.Cdn/profiles/securityPolicies@2024-02-01' = {
  parent: profile
  name: 'waf-security-policy'
  properties: {
    parameters: {
      type: 'WebApplicationFirewall'
      wafPolicy: { id: waf.id }
      associations: [
        {
          domains: [ { id: endpoint.id } ]
          patternsToMatch: [ '/*' ]
        }
      ]
    }
  }
}

// Fan Front Door's access / health-probe / WAF logs to Log Analytics (for KQL
// verification) and — when enableEventHub is set — also to Event Hubs (the
// Phase-2 ClickHouse/Kafka ingestion transport).
resource diagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'afd-diagnostics'
  scope: profile
  properties: union({
    workspaceId: logAnalytics.id
    logs: [
      { category: 'FrontDoorAccessLog', enabled: true }
      { category: 'FrontDoorHealthProbeLog', enabled: true }
      { category: 'FrontDoorWebApplicationFirewallLog', enabled: true }
    ]
  }, enableEventHub ? {
    eventHubAuthorizationRuleId: ehDiagRule.id
    eventHubName: eventHub.name
  } : {})
}

output afdEndpointHostName string = endpoint.properties.hostName
output originHostName string = originApp.properties.configuration.ingress.fqdn
output logAnalyticsCustomerId string = logAnalytics.properties.customerId
output logAnalyticsResourceId string = logAnalytics.id
output eventHubNamespace string = enableEventHub ? ehNamespace.name : ''
output eventHubName string = enableEventHub ? eventHub.name : ''
output wafPolicyName string = waf.name
output profileName string = profile.name
