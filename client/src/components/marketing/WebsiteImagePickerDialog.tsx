/**
 * Modal for browsing the Synozur website media library and picking an image.
 * Used from the blog-post RichTextEditor toolbar (insert inline image) and the
 * WebsitePublishDialog hero-image section (set hero by media id).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Image as ImageIcon, Search, Loader2, ChevronLeft, ChevronRight } from "lucide-react";

export interface WebsiteMediaItem {
  id: string;
  filename: string;
  altText?: string;
  type: string;
  publicUrl: string;
  optimizedUrl?: string;
  categoryId?: string;
}

interface MediaCategory {
  id: string;
  name: string;
  slug: string;
}

interface MediaList {
  items: WebsiteMediaItem[];
  total: number;
  page: number;
  perPage: number;
}

interface WebsiteImagePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: WebsiteMediaItem) => void;
}

const PER_PAGE = 24;

export function WebsiteImagePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: WebsiteImagePickerDialogProps) {
  const [categoryId, setCategoryId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<WebsiteMediaItem | null>(null);

  const { data: categories = [], isLoading: catsLoading } = useQuery<MediaCategory[]>({
    queryKey: ["/api/integrations/website/media-categories"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/website/media-categories", { credentials: "include" });
      return r.ok ? r.json() : [];
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const { data: mediaList, isLoading: mediaLoading, isFetching } = useQuery<MediaList>({
    queryKey: ["/api/integrations/website/media", categoryId, page, PER_PAGE],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), perPage: String(PER_PAGE) });
      if (categoryId && categoryId !== "all") params.set("categoryId", categoryId);
      const r = await fetch(`/api/integrations/website/media?${params}`, { credentials: "include" });
      return r.ok ? r.json() : { items: [], total: 0, page: 1, perPage: PER_PAGE };
    },
    enabled: open,
    staleTime: 60 * 1000,
  });

  const allItems = mediaList?.items ?? [];
  const filteredItems = search.trim()
    ? allItems.filter((item) =>
        (item.filename ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (item.altText ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : allItems;

  const total = mediaList?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const handleConfirm = () => {
    if (!selected) return;
    onSelect(selected);
    onOpenChange(false);
    setSelected(null);
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelected(null);
    setSearch("");
    setPage(1);
    setCategoryId("all");
  };

  const handleCategoryChange = (val: string) => {
    setCategoryId(val);
    setPage(1);
    setSelected(null);
  };

  const isLoading = catsLoading || mediaLoading;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Browse website images</DialogTitle>
          <DialogDescription>
            Pick an image from the Synozur website media library.
          </DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="flex gap-2 shrink-0">
          <Select value={categoryId} onValueChange={handleCategoryChange}>
            <SelectTrigger className="w-44 h-8 text-xs" data-testid="select-website-image-category">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Filter by filename…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
              data-testid="input-website-image-search"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading || isFetching ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {search ? "No images match your filter." : "No images found in this category."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 p-1">
              {filteredItems.map((item) => {
                const thumb = item.optimizedUrl || item.publicUrl;
                const isSelected = selected?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelected(isSelected ? null : item)}
                    className={`group relative rounded-lg overflow-hidden border-2 transition-all text-left ${
                      isSelected
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-transparent hover:border-muted-foreground/30"
                    }`}
                    title={item.altText || item.filename}
                    data-testid={`website-media-item-${item.id}`}
                  >
                    <div className="aspect-square bg-muted overflow-hidden">
                      <img
                        src={thumb}
                        alt={item.altText || item.filename}
                        className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate px-1.5 py-1 leading-tight">
                      {item.altText || item.filename}
                    </p>
                    {isSelected && (
                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                        <svg className="w-2.5 h-2.5 text-primary-foreground" fill="currentColor" viewBox="0 0 12 12">
                          <path d="M10 3L5 8.5 2 5.5l-1 1 4 4 6-7z" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between shrink-0 border-t pt-2 text-xs text-muted-foreground">
            <span>Page {page} of {totalPages} · {total} images</span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={page <= 1 || isFetching}
                onClick={() => setPage((p) => p - 1)}
                data-testid="button-website-media-prev"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={page >= totalPages || isFetching}
                onClick={() => setPage((p) => p + 1)}
                data-testid="button-website-media-next"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 shrink-0 border-t pt-3">
          <Button variant="outline" size="sm" onClick={handleClose} data-testid="button-website-image-picker-cancel">
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!selected}
            onClick={handleConfirm}
            data-testid="button-website-image-picker-confirm"
          >
            {selected ? `Insert "${selected.altText || selected.filename}"` : "Select an image"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
