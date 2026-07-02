# Deploying FrontLens to Azure

This guide provisions FrontLens with the Azure CLI and Bicep. Every value in
angle brackets (`<…>`) is a placeholder; substitute your own subscription,
resource groups, and names.

> You don't need any of this to try FrontLens. `npm run dev` runs the full UI on
> the built-in **Demo** (mock) data source with zero Azure resources.

## Prerequisites

- An Azure subscription and the [Azure CLI](https://learn.microsoft.com/cli/azure/); run `az login`
- Bicep tooling: `az bicep install`
- A resource group: `az group create -n <resource-group> -l <region>`

## The two Bicep stacks

| Stack | File | Provisions |
| --- | --- | --- |
| **Dashboard app** | [infra/main.bicep](infra/main.bicep) | The FrontLens container (UI + BFF), a Container Apps environment, an Azure Container Registry, a user-assigned managed identity, and Log Analytics for the app's own logs. |
| **Front Door + log source** *(optional)* | [infra/afd-e2e.bicep](infra/afd-e2e.bicep) | A self-contained Premium Azure Front Door + WAF in front of a "hello world" origin, streaming access / WAF / health-probe logs to Log Analytics, a ready-made source for **Live** mode. |
| **Alert rules** *(optional)* | [infra/alerts.bicep](infra/alerts.bicep) | Native Azure Monitor scheduled-query (log) alerts over the Front Door workspace - 5xx error rate, p95 latency, and WAF block surge - plus an Action Group that notifies email/webhook. No extra compute; reuses the existing log pipeline. |

Deploy only the dashboard if you already have a Front Door whose access logs land
in a Log Analytics workspace. Deploy both to stand up an end-to-end demo. Add the
alert stack to get delivered notifications for the same incidents the Anomalies
page surfaces.

## Stack 1: the dashboard app

The image is built in the cloud with ACR Tasks, so no local Docker is required.

```bash
RG=<resource-group>
ACR=<your-registry>                 # an Azure Container Registry you control

# Build + push a uniquely tagged image:
TAG="$(date +%Y%m%d%H%M)"
az acr build -r "$ACR" -t frontlens:$TAG -t frontlens:latest -f Dockerfile .

# Deploy / update the app:
az deployment group create -g "$RG" -f infra/main.bicep \
  -p infra/main.parameters.json \
  -p containerImage="$ACR.azurecr.io/frontlens:$TAG"
```

For a code-only change you can skip Bicep and roll a new revision directly:

```bash
az containerapp update -g "$RG" -n <container-app> \
  --image "$ACR.azurecr.io/frontlens:$TAG"
```

The app defaults to the **Demo** (`mock`) source, so it runs with no backend.

## Stack 2: Front Door + a live log source

```bash
az deployment group create -g <e2e-resource-group> -f infra/afd-e2e.bicep
```

This creates a Premium Front Door, a WAF policy in Prevention mode, an origin
Container App, and a diagnostic setting that streams logs to a Log Analytics
workspace. An Event Hubs stream (the Phase-2 ClickHouse/Kafka ingestion transport)
is **off by default**; redeploy with `-p enableEventHub=true` to add it.

The deployment prints the Front Door endpoint as an output. Drive some traffic at
it so there are logs to explore:

```bash
npm run gen:traffic -- --host <your-endpoint>.azurefd.net --count 1500
```

## Stack 3: alert rules (optional)

Provision native Azure Monitor scheduled-query alerts over the **same** Front Door
workspace, so the incidents the Anomalies page surfaces also arrive as
email/webhook notifications. No extra compute is created - the rules query the
existing logs on a schedule.

```bash
# Resolve the workspace resource ID (the e2e stack outputs it):
WS_ID=$(az deployment group show -g <e2e-resource-group> -n afd-e2e \
          --query properties.outputs.logAnalyticsResourceId.value -o tsv)

az deployment group create -g <e2e-resource-group> -f infra/alerts.bicep \
  -p workspaceResourceId="$WS_ID" \
     alertEmail=you@example.com \
     enableAlerts=true
```

Rules are disabled unless you pass `enableAlerts=true` **and** an `alertEmail` (or
`alertWebhookUrl`), so a bare deploy never creates a noisy alert with nowhere to
send. Tune thresholds with `error5xxPercentThreshold`, `p95LatencyMsThreshold`,
and `wafBlockThreshold`. To notify Teams/Slack, pass an incoming-webhook URL as
`alertWebhookUrl`.

## Wiring up Live mode

Point the dashboard at real Front Door access logs by setting these on the
container app and granting it read access to the workspace:

| Setting | Value |
| --- | --- |
| `AFD_SOURCES` | `mock,loganalytics` (exposes the Demo/Live toggle) |
| `LOG_ANALYTICS_WORKSPACE_ID` | the workspace **customer ID (GUID)** |
| `AZURE_CLIENT_ID` | the managed identity's client ID |

The identity needs the built-in **Log Analytics Reader** role on the workspace;
[infra/modules/log-analytics-reader.bicep](infra/modules/log-analytics-reader.bicep)
assigns it. `main.bicep` takes the workspace GUID and resource ID as parameters.
Set them in [infra/main.parameters.json](infra/main.parameters.json) or pass them
with `-p` at deploy time. Leave them empty to keep Live mode off.

## Tear down

```bash
az group delete -n <e2e-resource-group> --yes --no-wait   # Front Door + WAF + origin
az group delete -n <resource-group> --yes --no-wait       # dashboard app + ACR
```

## Cost notes

- The **Front Door + WAF** stack is the expensive half: a Premium profile with
  managed WAF rule sets bills continuously. Tear it down when you are not actively
  exercising the live log pipeline.
- The **dashboard** is right-sized to 0.5 vCPU / 1 GiB and scales to zero, so it
  bills only while serving requests.
- A **Log Analytics daily cap** (`logAnalyticsDailyCapGb`, default 1 GB) bounds
  log ingestion on both workspaces.
- **Event Hubs** is off by default; enable it only if you need the streaming
  ingestion transport.
