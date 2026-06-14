"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={logout}
      className="text-sm font-medium underline opacity-70 hover:opacity-100"
    >
      Sign out
    </button>
  );
}
