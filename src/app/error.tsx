"use client";

import Link from "next/link";
import { Button, Display, Eyebrow } from "@/components/ui";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="glass rise max-w-md rounded-3xl p-8">
        <Eyebrow className="text-danger">Something broke</Eyebrow>
        <Display className="mt-3 text-4xl">We hit a snag.</Display>
        <p className="mt-3 break-words text-sm text-stone">{error.message}</p>
        <div className="mt-6 flex gap-3">
          <Button onClick={reset}>Try again</Button>
          <Link href="/" className="tactile glass rounded-full px-5 py-2.5 text-sm">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
