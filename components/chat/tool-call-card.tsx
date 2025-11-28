'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Wrench,
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle,
  XCircle,
  Server,
  ImageIcon,
  X,
} from 'lucide-react';
import type { ToolCallInfo } from '@/lib/mcp/types';

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

// 이미지 확대 보기 모달
function ImageModal({ 
  src, 
  onClose 
}: { 
  src: string; 
  onClose: () => void;
}) {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
      >
        <X className="w-6 h-6 text-white" />
      </button>
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <img
          src={src}
          alt="Generated image"
          className="max-w-full max-h-[90vh] object-contain rounded-lg"
        />
      </div>
    </div>
  );
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const statusIcon = {
    pending: <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />,
    executing: <Loader2 className="w-4 h-4 text-cyan-500 animate-spin" />,
    completed: <CheckCircle className="w-4 h-4 text-emerald-500" />,
    error: <XCircle className="w-4 h-4 text-red-500" />,
  };

  const statusText = {
    pending: '대기 중',
    executing: '실행 중',
    completed: '완료',
    error: '오류',
  };

  const statusColor = {
    pending: 'border-yellow-500/30 bg-yellow-500/5',
    executing: 'border-cyan-500/30 bg-cyan-500/5',
    completed: 'border-emerald-500/30 bg-emerald-500/5',
    error: 'border-red-500/30 bg-red-500/5',
  };

  const hasArguments = Object.keys(toolCall.arguments || {}).length > 0;
  const hasResult = toolCall.result !== undefined || toolCall.error !== undefined;
  const hasImages = toolCall.images && toolCall.images.length > 0;

  return (
    <div
      className={`my-2 rounded-lg border ${statusColor[toolCall.status]} overflow-hidden transition-all`}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Wrench className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <span className="font-mono text-sm text-violet-300 truncate">
            {toolCall.name}
          </span>
          <span className="text-xs text-gray-500">•</span>
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <Server className="w-3 h-3" />
            <span className="truncate">{toolCall.serverName}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-400">{statusText[toolCall.status]}</span>
          {statusIcon[toolCall.status]}
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-white/10">
          {/* Arguments */}
          {hasArguments && (
            <div className="pt-3">
              <div className="text-xs font-medium text-gray-400 mb-1.5">인자</div>
              <pre className="p-2 bg-black/20 rounded text-xs font-mono text-gray-300 overflow-x-auto max-h-32 overflow-y-auto">
                {JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            </div>
          )}

          {/* Images */}
          {hasImages && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-400 mb-1.5">
                <ImageIcon className="w-3.5 h-3.5" />
                생성된 이미지 ({toolCall.images!.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {toolCall.images!.map((img, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedImage(img.url)}
                    className="relative group overflow-hidden rounded-lg border border-white/10 hover:border-violet-500/50 transition-colors"
                  >
                    <img
                      src={img.url}
                      alt={`Generated image ${index + 1}`}
                      className="w-32 h-32 object-cover"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-xs text-white">확대 보기</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Result */}
          {hasResult && (
            <div>
              <div className="text-xs font-medium text-gray-400 mb-1.5">
                {toolCall.error ? '오류' : '결과'}
              </div>
              {toolCall.error ? (
                <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                  {toolCall.error}
                </div>
              ) : (
                <pre className="p-2 bg-black/20 rounded text-xs font-mono text-gray-300 overflow-x-auto max-h-48 overflow-y-auto">
                  {typeof toolCall.result === 'string'
                    ? toolCall.result
                    : JSON.stringify(toolCall.result, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Timing */}
          {toolCall.completedAt && toolCall.startedAt && (
            <div className="text-xs text-gray-500">
              실행 시간: {toolCall.completedAt - toolCall.startedAt}ms
            </div>
          )}
        </div>
      )}

      {/* Image Modal */}
      {selectedImage && (
        <ImageModal src={selectedImage} onClose={() => setSelectedImage(null)} />
      )}
    </div>
  );
}

// 여러 도구 호출을 표시하는 컴포넌트
interface ToolCallsListProps {
  toolCalls: ToolCallInfo[];
}

export function ToolCallsList({ toolCalls }: ToolCallsListProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="space-y-1">
      {toolCalls.map((toolCall) => (
        <ToolCallCard key={toolCall.id} toolCall={toolCall} />
      ))}
    </div>
  );
}

