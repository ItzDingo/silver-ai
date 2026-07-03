import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { encrypt } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const { username, password, name, avatarUrl } = await req.json();

    if (!username || !password || !name) {
      return NextResponse.json(
        { error: "Username, password and name are required" },
        { status: 400 }
      );
    }

    // Clean username (lowercase, trim)
    const cleanUsername = username.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
      where: { username: cleanUsername },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Username is already taken" },
        { status: 400 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user and default settings in a transaction
    const user = await prisma.$transaction(async (tx) => {
      return tx.user.create({
        data: {
          username: cleanUsername,
          passwordHash,
          name: name.trim(),
          avatarUrl,
        },
      });
    });

    // Create token
    const token = await encrypt({
      userId: user.id,
      username: user.username,
      name: user.name,
    });

    // Create response with cookies
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    });

    response.cookies.set({
      name: "token",
      value: token,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
