import { auth } from "../auth";

export async function getSessionUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  return session.user;
}
