/**
 * JWT authentication utilities using the `jose` library.
 * Provides admin token signing, verification, and a Next.js Route Handler helper.
 */

import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-in-production"
);
const JWT_ALGORITHM = "HS256";
const JWT_EXPIRE_MINUTES = parseInt(
  process.env.JWT_EXPIRE_MINUTES ?? "480",
  10
);

export interface AdminPayload {
  sub: string;
  role: string;
}

/** Create a signed JWT for the admin user. */
export async function signAdminToken(username: string): Promise<string> {
  return new SignJWT({ sub: username, role: "admin" })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${JWT_EXPIRE_MINUTES}m`)
    .sign(JWT_SECRET);
}

/** Verify a JWT and return the payload, or null if invalid. */
export async function verifyToken(
  token: string
): Promise<AdminPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as AdminPayload;
  } catch {
    return null;
  }
}

/** Extract the Bearer token from an Authorization header. */
function extractBearer(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7).trim();
}

/**
 * Middleware helper for admin-only Route Handlers.
 *
 * Returns a 401/403 NextResponse on failure, or null on success.
 * Usage:
 *   const deny = await requireAdmin(req);
 *   if (deny) return deny;
 */
export async function requireAdmin(
  req: NextRequest
): Promise<NextResponse | null> {
  const token = extractBearer(req);
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const payload = await verifyToken(token);
  if (!payload || payload.role !== "admin") {
    return NextResponse.json({ detail: "Admin access required" }, { status: 403 });
  }

  return null;
}

/** Verify admin credentials against environment variables. */
export function verifyAdminCredentials(
  username: string,
  password: string
): boolean {
  const expectedUser = process.env.ADMIN_USERNAME ?? "admin";
  const expectedPass = process.env.ADMIN_PASSWORD ?? "";
  return username === expectedUser && password === expectedPass;
}
