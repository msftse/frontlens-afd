// FrontLens - Azure infrastructure (resource-group scoped).
//   az group create -n frontlens-rg -l eastus
//   az deployment group create -g frontlens-rg -f infra/main.bicep -p infra/main.parameters.json
//
// Provisions: Log Analytics (app logs), Container Apps environment, ACR, a
// user-assigned managed identity (AcrPull), and the FrontLens container app.
//
// Data sources:
//  - 'mock'         - built-in synthetic demo data (no dependencies).
//  - 'loganalytics' - LIVE Azure Front Door logs, queried straight from the
//                     Log Analytics workspace the AFD diagnostic setting streams
//                     to (see logAnalyticsWorkspaceId / logAnalyticsResourceId).
//                     Adds NO always-on compute - just an RBAC grant.
//  - 'clickhouse'   - external columnar store (Phase 2); point CLICKHOUSE_URL at it.
//
// AFD_SOURCES lists which sources the UI can switch between at runtime.

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Prefix for resource names.')
param namePrefix string = 'frontlens'

@description('Daily ingestion cap (GB) for the app Log Analytics workspace. Use -1 for no cap.')
param logAnalyticsDailyCapGb int = 1

@description('Container image (e.g. <acr>.azurecr.io/frontlens:latest). Defaults to a placeholder.')
param containerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Default data source: mock, loganalytics, or clickhouse.')
@allowed(['mock', 'loganalytics', 'clickhouse'])
param dataSource string = 'mock'

@description('Comma list of data sources the UI may switch between, e.g. "mock,loganalytics".')
param dataSources string = 'mock'

@description('Log Analytics workspace GUID (customerId) to query in live mode. Empty disables live mode.')
param logAnalyticsWorkspaceId string = ''

@description('Full resourceId of that workspace - the scope for the read-only RBAC grant. May live in another resource group.')
param logAnalyticsResourceId string = ''

param clickhouseUrl string = ''
param clickhouseUser string = 'default'
param clickhouseDatabase string = 'afd'
@secure()
param clickhousePassword string = ''

@description('Entra ID app (client) ID for SSO. Leave empty to disable auth.')
param authClientId string = ''
@secure()
param authClientSecret string = ''
param authIssuer string = ''
param allowedTenantId string = ''
@secure()
param authSecret string = ''

var tags = { app: 'frontlens', managedBy: 'bicep' }
var acrName = toLower(replace('${namePrefix}acr${uniqueString(resourceGroup().id)}', '-', ''))

// ---- Observability ----
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: logAnalyticsDailyCapGb }
  }
}

// ---- Identity + registry ----
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id'
  location: location
  tags: tags
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, acrPullRoleId)
  scope: acr
  properties: {
    principalId: identity.properties.principalId
    roleDefinitionId: acrPullRoleId
    principalType: 'ServicePrincipal'
  }
}

// ---- Container Apps environment ----
resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
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

var authEnabled = !empty(authClientId)

// Azure Container Apps rejects secrets declared with an empty value, so only
// include the ones that are actually set (mock/no-auth deploys have none).
var appSecrets = concat(
  empty(clickhousePassword) ? [] : [ { name: 'clickhouse-password', value: clickhousePassword } ],
  empty(authClientSecret) ? [] : [ { name: 'auth-client-secret', value: authClientSecret } ],
  empty(authSecret) ? [] : [ { name: 'auth-secret', value: authSecret } ]
)

var baseEnv = [
  { name: 'AFD_DATASOURCE', value: dataSource }
  { name: 'AFD_SOURCES', value: dataSources }
  { name: 'LOG_ANALYTICS_WORKSPACE_ID', value: logAnalyticsWorkspaceId }
  // Bind DefaultAzureCredential to THIS user-assigned identity inside the app.
  { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
  { name: 'CLICKHOUSE_URL', value: clickhouseUrl }
  { name: 'CLICKHOUSE_USER', value: clickhouseUser }
  { name: 'CLICKHOUSE_DATABASE', value: clickhouseDatabase }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_ID', value: authClientId }
  { name: 'AUTH_MICROSOFT_ENTRA_ID_ISSUER', value: authIssuer }
  { name: 'AUTH_ALLOWED_TENANT_ID', value: allowedTenantId }
]

// A secretRef is only valid when the backing secret above was declared.
var secretEnv = concat(
  empty(clickhousePassword) ? [] : [ { name: 'CLICKHOUSE_PASSWORD', secretRef: 'clickhouse-password' } ],
  empty(authClientSecret) ? [] : [ { name: 'AUTH_MICROSOFT_ENTRA_ID_SECRET', secretRef: 'auth-client-secret' } ],
  empty(authSecret) ? [] : [ { name: 'AUTH_SECRET', secretRef: 'auth-secret' } ]
)

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: namePrefix
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: appSecrets
    }
    template: {
      containers: [
        {
          name: 'frontlens'
          image: containerImage
          // 0.5 vCPU / 1Gi is ample for the Next.js standalone server (mock);
          // the app scales to zero, so this is billed only while serving.
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: concat(baseEnv, secretEnv)
        }
      ]
      scale: {
        // Scale to zero when idle (sporadic internal use) to minimise cost; the
        // HTTP rule scales up on demand. Cold start is acceptable here.
        minReplicas: 0
        maxReplicas: 5
        rules: [
          {
            name: 'http-scale'
            http: { metadata: { concurrentRequests: '80' } }
          }
        ]
      }
    }
  }
}

// ---- Live mode: read-only access to the AFD logs workspace ----
// Grants the app identity "Log Analytics Reader" on the workspace AFD streams
// to. The workspace usually lives in another resource group, so the grant runs
// as a module scoped to that RG (parsed from its resourceId).
var laRgName = empty(logAnalyticsResourceId) ? '' : split(logAnalyticsResourceId, '/')[4]
var laWsName = empty(logAnalyticsResourceId) ? '' : last(split(logAnalyticsResourceId, '/'))

module logAnalyticsReader 'modules/log-analytics-reader.bicep' = if (!empty(logAnalyticsResourceId)) {
  name: 'frontlens-la-reader'
  scope: resourceGroup(laRgName)
  params: {
    workspaceName: laWsName
    principalId: identity.properties.principalId
  }
}

output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output authEnabled bool = authEnabled
output liveModeEnabled bool = !empty(logAnalyticsWorkspaceId)
output acrLoginServer string = acr.properties.loginServer
output identityClientId string = identity.properties.clientId
output identityPrincipalId string = identity.properties.principalId
