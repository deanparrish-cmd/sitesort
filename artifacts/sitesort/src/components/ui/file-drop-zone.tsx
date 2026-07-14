import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, FileText, X, Loader2, AlertTriangle } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";

interface UploadedFile {
  url: string;
  originalName: string;
  size: number;
  mimetype: string;
}

interface FileDropZoneProps {
  onUploaded: (file: UploadedFile) => void;
  onCleared: () => void;
  accept?: string;
  className?: string;
}

const ACCEPTED_EXTS = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.dwg,.dxf,.dwf,.rvt,.ifc";

export function FileDropZone({ onUploaded, onCleared, accept = ACCEPTED_EXTS, className }: FileDropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // Prevent the browser from opening dropped files as a new page (whole document).
  // Also ensures a "copy" cursor appears over the dialog backdrop or any surrounding
  // area, so the user doesn't think drag-and-drop is disabled.
  useEffect(() => {
    const allow = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const block = (e: DragEvent) => { e.preventDefault(); };
    document.addEventListener("dragover", allow);
    document.addEventListener("drop", block);
    return () => {
      document.removeEventListener("dragover", allow);
      document.removeEventListener("drop", block);
    };
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const token = localStorage.getItem("sitesort_token");
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Upload failed");
      }
      const data: UploadedFile = await res.json();
      setUploaded(data);
      onUploaded(data);
    } catch (e: any) {
      setError(e.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [onUploaded]);

  const clear = () => {
    setUploaded(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
    onCleared();
  };

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current++;
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => {
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  if (uploaded) {
    return (
      <div className={cn("flex items-center gap-3 p-4 bg-success/5 border border-success/30 rounded-xl", className)}>
        <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-success" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{uploaded.originalName}</p>
          <p className="text-xs text-muted-foreground">{formatBytes(uploaded.size)}</p>
        </div>
        <button onClick={clear} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        onDragEnter={onDragEnter}
        onDragOver={e => e.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed rounded-xl cursor-pointer transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-input hover:border-primary/50 hover:bg-muted/30",
          uploading && "cursor-not-allowed opacity-60"
        )}
      >
        {uploading ? (
          <>
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground font-medium">Uploading…</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
              <Upload className="w-6 h-6 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-sm">Drop file here or <span className="text-primary underline">browse</span></p>
              <p className="text-xs text-muted-foreground mt-1">PDF, images, Word, Excel, DWG, DXF, DWF — up to 100MB</p>
            </div>
          </>
        )}
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onInputChange} />
      </div>
      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
