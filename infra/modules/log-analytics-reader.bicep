// Grants a principal the read-only "Log Analytics Reader" role on an existing
// Log Analytics workspace. Deployed at the workspace's resource-group scope so
// it works cross-RG (the FrontLens app identity lives in a different RG than the
// Azure Front Door diagnostics workspace).

@description('Name of the existing Log Analytics workspace to grant read access on.')
param workspaceName string

@description('Principal (objectId) of the identity to grant the role to.')
param principalId string

// Built-in "Log Analytics Reader" role (verified GUID).
var logAnalyticsReaderRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '73c42c96-874c-492b-b04d-ab87d138a893'
)

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: workspaceName
}

resource readerAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(workspace.id, principalId, logAnalyticsReaderRoleId)
  scope: workspace
  properties: {
    principalId: principalId
    roleDefinitionId: logAnalyticsReaderRoleId
    principalType: 'ServicePrincipal'
  }
}
