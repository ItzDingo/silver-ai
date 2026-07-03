import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET: List all chats for the authenticated user
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const chats = await prisma.chat.findMany({
      where: { userId: session.userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
      },
    });

    return NextResponse.json({ success: true, chats });
  } catch (error: any) {
    console.error("List chats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST: Create a new chat
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { title } = await req.json();

    const chat = await prisma.chat.create({
      data: {
        title: title || "New Chat",
        userId: session.userId,
      },
    });

    return NextResponse.json({ success: true, chat });
  } catch (error: any) {
    console.error("Create chat error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
