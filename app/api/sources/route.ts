import { availableSourceKinds, defaultSourceKind } from "@/lib/datasource";

/**
 * Tells the client which data sources this deployment can serve, and which is
 * the default. The UI uses it to decide whether to show the Demo/Live toggle
 * and with what options. No secrets, no auth gate - it only exposes the
 * configured source *names*.
 */
export function GET() {
  return Response.json({
    default: defaultSourceKind(),
    available: availableSourceKinds(),
  });
}
