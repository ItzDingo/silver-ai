import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

// POST: Add a message to a chat
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { role, content, thought, thinkingTime, imageUrl } = await req.json();

    // Verify the chat belongs to the user
    const chat = await prisma.chat.findFirst({
      where: { id, userId: session.userId },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    const message = await prisma.message.create({
      data: {
        chatId: id,
        role,
        content,
        thought,
        thinkingTime,
        imageUrl,
      },
    });

    // Update chat's updatedAt
    await prisma.chat.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    return NextResponse.json({ success: true, message });
  } catch (error: any) {
    console.error("Create message error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
