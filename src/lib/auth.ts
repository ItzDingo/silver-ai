import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";

const JWT_SECRET = process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || "fallback-secret-key-keep-it-safe";
const key = new TextEncoder().encode(JWT_SECRET);

export interface JWTPayload {
  userId: string;
  username: string;
  name: string;
}

export async function encrypt(payload: JWTPayload): Promise<string> {
  return await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d") // Match cookie duration (30 days auto-login)
    .sign(key);
}

export async function decrypt(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    return payload as unknown as JWTPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Retrieves the session from cookies.
 * Can be called with a NextRequest (e.g. in middleware) or without (e.g. in Server Components / API Routes).
 */
export async function getSession(req?: NextRequest): Promise<JWTPayload | null> {
  let token: string | undefined;

  if (req) {
    token = req.cookies.get("token")?.value;
  } else {
    const cookieStore = await cookies();
    token = cookieStore.get("token")?.value;
  }

  if (!token) return null;
  return await decrypt(token);
}
