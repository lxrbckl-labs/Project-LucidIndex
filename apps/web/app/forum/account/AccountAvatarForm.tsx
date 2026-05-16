'use client'

/**
 * AccountAvatarForm — profile photo uploader for the forum account
 * page. Pure client surface: validates the chosen file, shows a local
 * preview while the multipart POST to /api/forum/account/avatar is
 * in flight, and refreshes server-rendered surfaces (sidebar avatar,
 * "Current photo" slot) once the upload lands.
 *
 * Mirrors the upload-side validation in the API route — same
 * MIME whitelist, same byte ceiling — so users get fast feedback
 * before the round-trip.
 */

import { ImagePlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB — matches the server cap

type Props = {
  username: string
  hasAvatar: boolean
}

export function AccountAvatarForm({ username, hasAvatar }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Tear down the local blob URL when a new file replaces it or the
  // component unmounts — otherwise we leak object URLs across uploads.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl])

  // Cache-bust the server-side avatar so a freshly-uploaded photo
  // immediately replaces the prior one in the preview slot rather
  // than waiting on the next page load to revalidate.
  const [version, setVersion] = useState(0)
  useEffect(() => {
    setVersion(Date.now())
  }, [])
  const currentAvatarUrl = hasAvatar ? `/api/forum/users/${username}/avatar?v=${version}` : null

  async function uploadFile(file: File) {
    if (pending) return
    setPending(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/forum/account/avatar', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        reason?: string
      }
      if (!res.ok || !data.ok) {
        const msg =
          data.reason === 'too_large'
            ? 'Image is too large (max 2 MB).'
            : data.reason === 'invalid_type'
              ? 'Use a PNG, JPEG, or WebP image.'
              : "Couldn't save the photo. Try again."
        toast.error(msg)
        return
      }
      toast.success('Profile photo updated.')
      // Drop the blob preview so the slot re-resolves to the freshly
      // uploaded server avatar (with a fresh cache-busting version).
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
      if (inputRef.current) inputRef.current.value = ''
      setVersion(Date.now())
      router.refresh()
    } catch {
      toast.error('Network error.')
    } finally {
      setPending(false)
    }
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.files?.[0] ?? null
    if (!next) return
    if (!ALLOWED_MIME.has(next.type)) {
      toast.error('Use a PNG, JPEG, or WebP image.')
      return
    }
    if (next.size > MAX_BYTES) {
      toast.error('That image is over the 2 MB limit.')
      return
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(next))
    void uploadFile(next)
  }

  return (
    <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-6">
      {/* Live preview doubles as the click target — clicking the square
          opens the native file picker via the sr-only input below.
          Falls back to the current server avatar, then to a placeholder
          glyph. */}
      <label
        htmlFor="avatar-upload"
        title="Click to upload a new photo"
        aria-busy={pending}
        className={`h-24 w-24 shrink-0 overflow-hidden rounded-md border border-input bg-background flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${
          pending ? 'opacity-60 cursor-wait pointer-events-none' : ''
        }`}
      >
        {previewUrl ? (
          // biome-ignore lint/performance/noImgElement: blob: URL not supported by next/image
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : currentAvatarUrl ? (
          // biome-ignore lint/performance/noImgElement: served via Route Handler bytea
          <img src={currentAvatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        )}
      </label>
      <input
        id="avatar-upload"
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleChange}
        disabled={pending}
        aria-label="Upload profile photo"
        className="sr-only"
      />
    </form>
  )
}
