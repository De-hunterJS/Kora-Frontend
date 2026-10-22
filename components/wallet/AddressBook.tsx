"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Trash2, Check, X, Copy, ChevronDown, ChevronUp, Search, UserPlus, Shield, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWalletStore } from "@/store";
import { isValidStellarAddress, truncateAddress } from "@/lib/utils";
import { toast } from "sonner";
import { buildLabelMessage, verifySignedLabel, isLabelVerified, type SignedLabel } from "@/store/walletStore";

type AddressBookEntry = {
  id: string;
  address: string;
  label: string;
  signedLabel?: SignedLabel;
};

export function AddressBook({ onClose, onSelect }: { onClose?: () => void; onSelect?: (entry: AddressBookEntry) => void }) {
  const t = useTranslations("addressBook");
  const { addressBook, addressBookGroups, addAddressBookEntry, updateAddressBookEntry, removeAddressBookEntry, toggleAddressBookFavorite, addAddressBookGroup, updateAddressBookGroup, removeAddressBookGroup } = useWalletStore();
  const connectedAddress = useWalletStore((s) => s.address);
  const publicKey = useWalletStore((s) => s.publicKey);
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAddr, setEditAddr] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editGroups, setEditGroups] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);

  const addrInputRef = useRef<HTMLInputElement>(null);
  const editAddrInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (editingId && editAddrInputRef.current) {
      editAddrInputRef.current.focus();
    }
  }, [editingId]);

  // Filter entries by search query and group
  const filteredEntries = addressBook.filter((e) => {
    if (filterGroup && !e.groupIds.includes(filterGroup)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      e.address.toLowerCase().includes(q) ||
      e.label.toLowerCase().includes(q)
    );
  });

  // Sort: favorites first
  const sortedEntries = [...filteredEntries].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return 0;
  });

  const validateAddress = useCallback((address: string): string | null => {
    if (!address) return null;
    if (!isValidStellarAddress(address)) return t("invalidAddress");
    return null;
  }, [t]);

  const handleAddrChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAddr(e.target.value);
    if (error) setError(null);
  };

  const handleAddrBlur = () => {
    if (!addr) {
      setError(null);
      return;
    }
    setError(validateAddress(addr));
  };

  const handleEditAddrChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditAddr(e.target.value);
    if (editError) setEditError(null);
  };

  const handleEditAddrBlur = () => {
    if (!editAddr) {
      setEditError(null);
      return;
    }
    setEditError(validateAddress(editAddr));
  };

  const add = () => {
    if (!addr) return;
    const validationError = validateAddress(addr);
    if (validationError) {
      setError(validationError);
      return;
    }
    addAddressBookEntry(addr, label, selectedGroups);
    setAddr("");
    setLabel("");
    setSelectedGroups([]);
    setError(null);
    addrInputRef.current?.focus();
  };

  const startEdit = (entry: AddressBookEntry) => {
    setEditingId(entry.id);
    setEditAddr(entry.address);
    setEditLabel(entry.label);
    setEditGroups(entry.groupIds || []);
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditAddr("");
    setEditLabel("");
    setEditGroups([]);
    setEditError(null);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const validationError = validateAddress(editAddr);
    if (validationError) {
      setEditError(validationError);
      return;
    }
    updateAddressBookEntry(editingId, { address: editAddr, label: editLabel, groupIds: editGroups });
    setEditingId(null);
    setEditAddr("");
    setEditLabel("");
    setEditGroups([]);
    setEditError(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const handleDelete = (id: string) => {
    if (confirmDeleteId === id) {
      removeAddressBookEntry(id);
      setConfirmDeleteId(null);
      if (editingId === id) cancelEdit();
    } else {
      setConfirmDeleteId(id);
    }
  };

  const cancelDelete = () => {
    setConfirmDeleteId(null);
  };

  const signLabel = async (entry: AddressBookEntry) => {
    if (!entry.label) return;
    setSigningId(entry.id);
    try {
      const connectedKey = publicKey || connectedAddress;
      if (!connectedKey) {
        toast.error(t("walletNotConnected"));
        return;
      }
      // Sign the canonical label payload with the connected wallet so the
      // attestation proves ownership of the labelling key (#1106 + #1062 verify).
      const signedAt = Date.now();
      const message = buildLabelMessage(entry.address, entry.label);
      const { getKit } = await import("@/hooks/useWallet");
      const { result } = await (getKit() as any).signMessage({
        message,
        publicKey: connectedKey,
      });
      const signature =
        typeof result === "string"
          ? result
          : Buffer.from(result, "base64").toString("hex");

      const signedLabel: SignedLabel = {
        address: entry.address,
        label: entry.label,
        signature,
        signedAt,
      };

      updateAddressBookEntry(entry.id, { signedLabel });
      toast.success(t("labelSigned"));
    } catch (error) {
      toast.error(t("signFailed"));
    } finally {
      setSigningId(null);
    }
  };

  const copyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success(t("addressCopied"));
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = address;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      toast.success(t("addressCopied"));
    }
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    }
  };

  // Close confirmation on outside click
  useEffect(() => {
    if (!confirmDeleteId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`[data-delete-id="${confirmDeleteId}"]`)) {
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [confirmDeleteId]);

  const displayedCount = sortedEntries.length;
  const totalCount = addressBook.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
            {totalCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("savedCount", { count: totalCount })}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={t("close")}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          {/* Group Manager Toggle */}
          {addressBookGroups.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowGroupManager(!showGroupManager)}
                className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{showGroupManager ? t("hideGroups") : t("manageGroups")}</span>
              </button>
            </div>
          )}

          {/* Group Manager */}
          {showGroupManager && (
            <div className="mb-4 rounded-lg border border-border bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Input
                  placeholder={t("groupNamePlaceholder")}
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddGroup()}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleAddGroup} disabled={!newGroupName.trim()}>
                  {t("addGroup")}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {addressBookGroups.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-sm"
                  >
                    {editingGroupId === group.id ? (
                      <>
                        <Input
                          value={editGroupName}
                          onChange={(e) => setEditGroupName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              updateAddressBookGroup(group.id, { name: editGroupName });
                              setEditingGroupId(null);
                            }
                            if (e.key === "Escape") setEditingGroupId(null);
                          }}
                          className="h-6 w-24 text-xs"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => {
                            updateAddressBookGroup(group.id, { name: editGroupName });
                            setEditingGroupId(null);
                          }}
                          className="text-success hover:text-success/80"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span>{group.name}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingGroupId(group.id);
                            setEditGroupName(group.name);
                          }}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteGroup(group.id)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add new entry form */}
          <form
            onSubmit={(e) => { e.preventDefault(); add(); }}
            className="rounded-lg border border-border bg-muted/30 p-4"
            aria-label={t("addNewContact")}
          >
            <div className="mb-3 flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">{t("addNewContact")}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <div>
                <label htmlFor="ab-address" className="sr-only">{t("addressPlaceholder")}</label>
                <Input
                  ref={addrInputRef}
                  id="ab-address"
                  placeholder={t("addressPlaceholder")}
                  value={addr}
                  onChange={handleAddrChange}
                  onBlur={handleAddrBlur}
                  onKeyDown={handleAddKeyDown}
                  error={error || undefined}
                  aria-invalid={!!error}
                  aria-describedby={error ? "ab-addr-error" : undefined}
                />
                {error && (
                  <p id="ab-addr-error" className="mt-1 text-xs text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="ab-label" className="sr-only">{t("labelPlaceholder")}</label>
                <Input
                  id="ab-label"
                  placeholder={t("labelPlaceholder")}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={handleAddKeyDown}
                />
              </div>
              <Button type="submit" disabled={!addr} aria-label={t("addButton")}>
                {t("addButton")}
              </Button>
            </div>
            {addressBookGroups.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {addressBookGroups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => toggleGroupInEntry(group.id)}
                    className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
                      selectedGroups.includes(group.id)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            )}
          </form>

          {/* Group filter tabs */}
          {addressBookGroups.length > 0 && (
            <div className="mt-3 flex items-center gap-1 overflow-x-auto">
              <button
                type="button"
                onClick={() => setFilterGroup(null)}
                className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${
                  filterGroup === null
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {t("all")}
              </button>
              {addressBookGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setFilterGroup(filterGroup === group.id ? null : group.id)}
                  className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${
                    filterGroup === group.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {group.name}
                </button>
              ))}
            </div>
          )}

          {/* Search & expand controls */}
          {totalCount > 0 && (
            <div className="mt-4 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <label htmlFor="ab-search" className="sr-only">{t("searchPlaceholder")}</label>
                <Input
                  id="ab-search"
                  placeholder={t("searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={t("clearSearch")}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-expanded={expanded}
                aria-label={expanded ? t("collapseAll") : t("expandAll")}
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">{expanded ? t("collapseAll") : t("expandAll")}</span>
              </button>
            </div>
          )}

          {/* Entry list */}
          <div
            ref={listRef}
            className="mt-3 max-h-[40vh] overflow-y-auto"
            role="list"
            aria-label={t("savedContacts")}
          >
            {sortedEntries.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {searchQuery ? t("noSearchResults") : t("noSaved")}
              </p>
            )}
            {sortedEntries.map((entry) => {
              const isEditing = editingId === entry.id;
              const isConfirmingDelete = confirmDeleteId === entry.id;

              return (
                <div
                  key={entry.id}
                  role="listitem"
                  data-delete-id={entry.id}
                  className="group flex flex-col gap-2 rounded-lg border border-border/60 px-4 py-3 transition-colors hover:border-border hover:bg-muted/30"
                >
                  {isEditing ? (
                    /* ── Inline edit mode ── */
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <div>
                        <label htmlFor={`edit-addr-${entry.id}`} className="sr-only">{t("addressPlaceholder")}</label>
                        <Input
                          ref={editAddrInputRef}
                          id={`edit-addr-${entry.id}`}
                          value={editAddr}
                          onChange={handleEditAddrChange}
                          onBlur={handleEditAddrBlur}
                          onKeyDown={handleEditKeyDown}
                          error={editError || undefined}
                          aria-invalid={!!editError}
                          aria-describedby={editError ? `edit-addr-error-${entry.id}` : undefined}
                        />
                        {editError && (
                          <p id={`edit-addr-error-${entry.id}`} className="mt-1 text-xs text-destructive" role="alert">
                            {editError}
                          </p>
                        )}
                      </div>
                      <div>
                        <label htmlFor={`edit-label-${entry.id}`} className="sr-only">{t("labelPlaceholder")}</label>
                        <Input
                          id={`edit-label-${entry.id}`}
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onKeyDown={handleEditKeyDown}
                          placeholder={t("labelPlaceholder")}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={saveEdit}
                          className="rounded-lg p-2 text-success transition-colors hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          aria-label={t("saveEdit")}
                        >
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          aria-label={t("cancelEdit")}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ) : isConfirmingDelete ? (
                    /* ── Delete confirmation ── */
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-destructive">
                        {t("confirmDeleteMessage", { label: entry.label || entry.address })}
                      </p>
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(entry.id)}
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-destructive-foreground bg-destructive transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          aria-label={t("confirmDelete")}
                        >
                          {t("confirmDelete")}
                        </button>
                        <button
                          type="button"
                          onClick={cancelDelete}
                          className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          aria-label={t("cancel")}
                        >
                          {t("cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Display mode ── */
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                          {entry.label || truncateAddress(entry.address, 8)}
                        </span>
                        {entry.signedLabel && verifySignedLabel(entry.signedLabel) && (
                          <span className="text-green-500 shrink-0" title={t("verifiedLabel")}>
                            <ShieldCheck className="h-4 w-4" />
                          </span>
                        )}
                        {entry.signedLabel && !verifySignedLabel(entry.signedLabel) && (
                          <span className="text-yellow-500 shrink-0" title={t("unverifiedLabel")}>
                            <Shield className="h-4 w-4" />
                          </span>
                        )}
                        {onSelect && (
                          <button
                            type="button"
                            onClick={() => onSelect(entry)}
                            className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            aria-label={t("selectContact", { label: entry.label || entry.address })}
                          >
                            {t("select")}
                          </button>
                        )}
                      </div>
                          <div className="mt-0.5 flex items-center gap-2">
                            <code className="text-xs text-muted-foreground">{truncateAddress(entry.address, 8)}</code>
                            <button
                              type="button"
                              onClick={() => copyAddress(entry.address)}
                              className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              aria-label={t("copyAddress", { address: entry.address })}
                            >
                              <Copy className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </div>
                          {expanded && (
                            <div className="mt-1">
                              <code className="text-xs text-muted-foreground/70 break-all">{entry.address}</code>
                            </div>
                          )}
                          {entry.groupIds && entry.groupIds.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {entry.groupIds.map((gid) => {
                                const group = addressBookGroups.find((g) => g.id === gid);
                                return group ? (
                                  <span key={gid} className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                                    {group.name}
                                  </span>
                                ) : null;
                              })}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
                          {entry.label && !entry.signedLabel && (
                            <button
                              type="button"
                              onClick={() => signLabel(entry)}
                              disabled={signingId === entry.id}
                              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-blue-500/10 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
                              aria-label={t("signLabel", { label: entry.label })}
                            >
                              <Shield className="h-4 w-4" aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => startEdit(entry)}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            aria-label={t("editContact", { label: entry.label || entry.address })}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(entry.id)}
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            aria-label={t("deleteContact", { label: entry.label || entry.address })}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {searchQuery && displayedCount > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("showingResults", { shown: displayedCount, total: totalCount })}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-6 py-3">
          <p className="text-xs text-muted-foreground">
            {t("footerHint")}
          </p>
          <Button variant="ghost" onClick={onClose} size="sm">
            {t("close")}
          </Button>
        </div>
      </div>
    </div>
  );
}
