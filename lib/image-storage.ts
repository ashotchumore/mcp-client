import { supabase } from './supabase';

const BUCKET_NAME = 'image_store';

export interface UploadImageResult {
  success: boolean;
  storagePath?: string;
  publicUrl?: string;
  error?: string;
}

export interface ImageMetadata {
  id: string;
  messageId: string;
  storagePath: string;
  originalFilename?: string;
  mimeType: string;
  sizeBytes?: number;
  createdAt: string;
}

/**
 * Base64 이미지를 Supabase Storage에 업로드
 */
export async function uploadImageToStorage(
  base64Data: string,
  sessionId: string,
  messageId: string,
  options?: {
    filename?: string;
    mimeType?: string;
  }
): Promise<UploadImageResult> {
  try {
    const mimeType = options?.mimeType || 'image/png';
    const extension = mimeType.split('/')[1] || 'png';
    const timestamp = Date.now();
    const filename = options?.filename || `image_${timestamp}.${extension}`;
    
    // Storage 경로: {sessionId}/{messageId}/{filename}
    const storagePath = `${sessionId}/${messageId}/${filename}`;

    // Base64 데이터에서 prefix 제거 (data:image/png;base64, 등)
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
    
    // Base64를 바이너리로 변환
    const binaryData = Buffer.from(base64Clean, 'base64');

    // Supabase Storage에 업로드
    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(storagePath, binaryData, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return { success: false, error: uploadError.message };
    }

    // Public URL 생성
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(storagePath);

    return {
      success: true,
      storagePath,
      publicUrl: urlData.publicUrl,
    };
  } catch (error) {
    console.error('Upload image error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload image',
    };
  }
}

/**
 * 이미지 메타데이터를 DB에 저장
 */
export async function saveImageMetadata(
  messageId: string,
  storagePath: string,
  options?: {
    originalFilename?: string;
    mimeType?: string;
    sizeBytes?: number;
  }
): Promise<ImageMetadata | null> {
  try {
    const { data, error } = await supabase
      .from('message_images')
      .insert({
        message_id: messageId,
        storage_path: storagePath,
        original_filename: options?.originalFilename,
        mime_type: options?.mimeType || 'image/png',
        size_bytes: options?.sizeBytes,
      })
      .select()
      .single();

    if (error) {
      console.error('Save image metadata error:', error);
      return null;
    }

    return {
      id: data.id,
      messageId: data.message_id,
      storagePath: data.storage_path,
      originalFilename: data.original_filename,
      mimeType: data.mime_type,
      sizeBytes: data.size_bytes,
      createdAt: data.created_at,
    };
  } catch (error) {
    console.error('Save image metadata error:', error);
    return null;
  }
}

/**
 * Storage 경로에서 Public URL 생성
 */
export function getImagePublicUrl(storagePath: string): string {
  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * 메시지에 연결된 이미지 목록 조회
 */
export async function getMessageImages(messageId: string): Promise<ImageMetadata[]> {
  try {
    const { data, error } = await supabase
      .from('message_images')
      .select('*')
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Get message images error:', error);
      return [];
    }

    return (data || []).map((item) => ({
      id: item.id,
      messageId: item.message_id,
      storagePath: item.storage_path,
      originalFilename: item.original_filename,
      mimeType: item.mime_type,
      sizeBytes: item.size_bytes,
      createdAt: item.created_at,
    }));
  } catch (error) {
    console.error('Get message images error:', error);
    return [];
  }
}

/**
 * 메시지 삭제 시 연결된 이미지 삭제
 * (DB는 CASCADE로 자동 삭제되므로 Storage만 정리)
 */
export async function deleteMessageImages(messageId: string): Promise<void> {
  try {
    // 먼저 이미지 메타데이터 조회
    const images = await getMessageImages(messageId);
    
    if (images.length === 0) return;

    // Storage에서 파일 삭제
    const paths = images.map((img) => img.storagePath);
    const { error } = await supabase.storage.from(BUCKET_NAME).remove(paths);

    if (error) {
      console.error('Delete storage files error:', error);
    }
  } catch (error) {
    console.error('Delete message images error:', error);
  }
}

/**
 * Base64 이미지 업로드 및 메타데이터 저장을 한번에 처리
 */
export async function uploadAndSaveImage(
  base64Data: string,
  sessionId: string,
  messageId: string,
  options?: {
    filename?: string;
    mimeType?: string;
  }
): Promise<{ publicUrl: string; metadata: ImageMetadata } | null> {
  // 1. Storage에 업로드
  const uploadResult = await uploadImageToStorage(
    base64Data,
    sessionId,
    messageId,
    options
  );

  if (!uploadResult.success || !uploadResult.storagePath) {
    console.error('Upload failed:', uploadResult.error);
    return null;
  }

  // Base64 데이터 크기 계산
  const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const sizeBytes = Math.ceil((base64Clean.length * 3) / 4);

  // 2. 메타데이터 저장
  const metadata = await saveImageMetadata(messageId, uploadResult.storagePath, {
    originalFilename: options?.filename,
    mimeType: options?.mimeType || 'image/png',
    sizeBytes,
  });

  if (!metadata) {
    console.error('Failed to save image metadata');
    return null;
  }

  return {
    publicUrl: uploadResult.publicUrl!,
    metadata,
  };
}

