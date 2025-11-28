import { NextRequest, NextResponse } from 'next/server';
import { uploadAndSaveImage } from '@/lib/image-storage';

export const runtime = 'nodejs';

interface UploadImageRequest {
  base64Data: string;
  sessionId: string;
  messageId: string;
  filename?: string;
  mimeType?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: UploadImageRequest = await request.json();
    const { base64Data, sessionId, messageId, filename, mimeType } = body;

    if (!base64Data || !sessionId || !messageId) {
      return NextResponse.json(
        { success: false, error: 'base64Data, sessionId, and messageId are required' },
        { status: 400 }
      );
    }

    const result = await uploadAndSaveImage(base64Data, sessionId, messageId, {
      filename,
      mimeType,
    });

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Failed to upload image' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      publicUrl: result.publicUrl,
      metadata: result.metadata,
    });
  } catch (error) {
    console.error('Upload image API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

