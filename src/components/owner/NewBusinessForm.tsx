"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";

export function NewBusinessForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/tenants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const body = (await r.json()) as { id?: string; error?: string };
    if (!r.ok || !body.id) {
      setError(body.error ?? "Could not create business");
      setBusy(false);
      return;
    }
    router.push(`/dashboard/${body.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Label htmlFor="name">Business name</Label>
        <Input id="name" autoFocus required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Harbourside Padel" />
      </div>
      {error && <p className="rounded-2xl bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" className="w-full" disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Start the conversation"}
      </Button>
    </form>
  );
}
