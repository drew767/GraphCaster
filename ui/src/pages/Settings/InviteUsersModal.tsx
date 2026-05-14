// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  Dialog,
  Input,
  RadioGroup,
  Tag,
  Text,
} from "../../components/ui";
import type { RadioOption } from "../../components/ui";
import { useUIStore } from "../../app/stores/uiStore";
import { useToast } from "../../toast/ToastProvider";
import type { UserRole } from "./Users";
import { pendingInvitationsApi } from "./pendingInvitations";

const PENDING_INVITATIONS_CHANGED_EVENT = "gc:pending-invitations-changed";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INVITE_USERS_MODAL_KEY = "user-invite";

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

interface InviteResult {
  email: string;
  inviteLink: string;
}

async function sendInvites(
  emails: string[],
  role: UserRole,
  message: string,
): Promise<InviteResult[]> {
  const resp = await fetch("/api/v1/users/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emails, role, message }),
  });
  if (resp.status === 404) throw Object.assign(new Error("not_found"), { status: 404 });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<InviteResult[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
}

// ---------------------------------------------------------------------------
// Inner form
// ---------------------------------------------------------------------------

interface InviteFormProps {
  onClose: () => void;
  onInvited?: () => void;
}

function InviteForm({ onClose, onInvited }: InviteFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [emailsRaw, setEmailsRaw] = useState("");
  const [role, setRole] = useState<UserRole>("editor");
  const [customMessage, setCustomMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const [emailError, setEmailError] = useState<string | undefined>();

  const INVITE_ROLES: UserRole[] = ["admin", "editor", "viewer"];

  const roleOptions: RadioOption<UserRole>[] = INVITE_ROLES.map((r) => ({
    value: r,
    label: t(`app.settings.users.roles.${r}`),
  }));

  const handleSend = useCallback(async () => {
    const emails = parseEmails(emailsRaw);
    if (emails.length === 0) {
      setEmailError(t("app.settings.users.invite.emailRequired"));
      return;
    }
    setEmailError(undefined);
    setSending(true);
    try {
      const res = await sendInvites(emails, role, customMessage);
      emails.forEach((email) => {
        pendingInvitationsApi.add({ email, role });
      });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(PENDING_INVITATIONS_CHANGED_EVENT));
      }
      onInvited?.();
      setResults(res);
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 404) {
        toast.warning(t("app.settings.users.endpointNotFound"));
        onClose();
      } else {
        toast.error(t("app.settings.users.invite.sendError"));
      }
    } finally {
      setSending(false);
    }
  }, [emailsRaw, role, customMessage, t, toast, onClose]);

  const handleCopy = useCallback(async (link: string, email: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied((prev) => ({ ...prev, [email]: true }));
      setTimeout(() => {
        setCopied((prev) => ({ ...prev, [email]: false }));
      }, 2000);
    } catch {
      // clipboard not available in test/secure contexts — ignore
    }
  }, []);

  if (results !== null) {
    return (
      <div className="gc-invite-results" data-testid="invite-results">
        <Text size="medium" weight="medium" className="gc-invite-results__heading">
          {t("app.settings.users.invite.linksReady")}
        </Text>
        <Text size="small" color="muted" className="gc-invite-results__sub">
          {t("app.settings.users.invite.linksDescription")}
        </Text>
        <div className="gc-invite-results__list">
          {results.map((r) => (
            <div key={r.email} className="gc-invite-results__row" data-testid={`invite-link-row-${r.email}`}>
              <span className="gc-invite-results__email">{r.email}</span>
              <code className="gc-invite-results__link">{r.inviteLink}</code>
              <Button
                variant="outline"
                size="xsmall"
                iconLeft={copied[r.email] ? "check" : "copy"}
                onClick={() => { void handleCopy(r.inviteLink, r.email); }}
                aria-label={t("app.settings.users.invite.copyLinkAria", { email: r.email })}
                data-testid={`copy-link-${r.email}`}
              >
                {copied[r.email]
                  ? t("app.settings.users.invite.copied")
                  : t("app.settings.users.invite.copy")}
              </Button>
            </div>
          ))}
        </div>
        <div className="gc-invite-results__footer">
          <Button variant="solid" onClick={onClose} data-testid="invite-done-btn">
            {t("app.settings.users.invite.done")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="gc-invite-form" data-testid="invite-form">
      <div className="gc-invite-form__field">
        <label className="gc-invite-form__label" htmlFor="invite-emails">
          {t("app.settings.users.invite.emailsLabel")}
          <span aria-hidden> *</span>
        </label>
        <Input
          id="invite-emails"
          value={emailsRaw}
          onChange={(e) => setEmailsRaw(e.target.value)}
          placeholder={t("app.settings.users.invite.emailsPlaceholder")}
          variant={emailError ? "error" : "default"}
          aria-describedby={emailError ? "invite-email-error" : undefined}
          data-testid="invite-emails-input"
        />
        {emailError && (
          <span id="invite-email-error" className="gc-invite-form__error" role="alert">
            {emailError}
          </span>
        )}
        <Text size="small" color="muted" className="gc-invite-form__hint">
          {t("app.settings.users.invite.emailsHint")}
        </Text>
      </div>

      <div className="gc-invite-form__field">
        <label className="gc-invite-form__label" id="invite-role-label">
          {t("app.settings.users.invite.roleLabel")}
        </label>
        <RadioGroup<UserRole>
          value={role}
          onValueChange={setRole}
          options={roleOptions}
          orientation="vertical"
          aria-label={t("app.settings.users.invite.roleLabel")}
          data-testid="invite-role-group"
        />
      </div>

      <div className="gc-invite-form__field">
        <label className="gc-invite-form__label" htmlFor="invite-message">
          {t("app.settings.users.invite.messageLabel")}
        </label>
        <textarea
          id="invite-message"
          className="gc-invite-form__textarea"
          value={customMessage}
          onChange={(e) => setCustomMessage(e.target.value)}
          placeholder={t("app.settings.users.invite.messagePlaceholder")}
          rows={3}
          data-testid="invite-message-textarea"
        />
      </div>

      <div className="gc-invite-form__footer">
        <Button variant="ghost" onClick={onClose} disabled={sending} data-testid="invite-cancel-btn">
          {t("app.settings.users.invite.cancel")}
        </Button>
        <Button
          variant="solid"
          onClick={() => { void handleSend(); }}
          loading={sending}
          data-testid="invite-send-btn"
        >
          {t("app.settings.users.invite.send")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal shell wired to uiStore
// ---------------------------------------------------------------------------

interface InviteUsersModalProps {
  onInvited?: () => void;
}

export function InviteUsersModal({ onInvited }: InviteUsersModalProps = {}) {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.isModalOpen(INVITE_USERS_MODAL_KEY));
  const closeModal = useUIStore((s) => s.closeModal);

  const handleClose = useCallback(() => {
    closeModal(INVITE_USERS_MODAL_KEY);
  }, [closeModal]);

  if (!open) return null;

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) handleClose(); }}
      size="medium"
      title={t("app.settings.users.invite.title")}
    >
      <InviteForm onClose={handleClose} onInvited={onInvited} />
    </Dialog>
  );
}
