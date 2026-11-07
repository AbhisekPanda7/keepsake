'use client';

import { useParams } from 'next/navigation';
import AlbumView from '@/components/AlbumView';

export default function AlbumPage() {
  const { id } = useParams();
  // Keyed so that going from one album to another starts completely fresh.
  return <AlbumView key={id} albumId={decodeURIComponent(id)} />;
}
