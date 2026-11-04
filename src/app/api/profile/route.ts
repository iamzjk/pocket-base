import { requireAccountStore } from "@/lib/auth";
import { errorResponse, readMutation } from "@/lib/errors";
import { publicName } from "@/lib/profile";

export async function GET(request: Request) {
  try {
    return Response.json(await (await requireAccountStore(request)).profile(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const body = await readMutation(request);
    return Response.json(await (await requireAccountStore(request)).saveProfile(publicName(body.displayName)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
