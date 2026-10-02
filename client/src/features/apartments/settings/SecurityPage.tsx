/**
 * Settings → Password & sign-in (DECISIONS D9). Email codes always work (that's also the "forgot password" path);
 * a password is optional, and two-step sign-in makes a password alone not enough (it also needs an emailed code).
 */
import { useState, type FC, type FormEvent } from 'react';
import { KeyRound, Mail, ShieldCheck, Trash2 } from 'lucide-react';
import { PASSWORD_MIN } from '@shared/core';
import { Button, Dialog, ListRow, Switch } from '@/ui';
import { PasswordInput } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { errorMessage, isApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useRemovePassword, useSecurity, useSetPassword, useSetTwoFactor } from '../api';
import { Group, RowIcon, RowsSkeleton, SettingsScreen } from './shared';

function securityError(err: unknown): string {
  if (isApiError(err, 'validation_failed')) return `Use at least ${PASSWORD_MIN} characters.`;
  return errorMessage(err);
}

const PasswordForm: FC<{ hasPassword: boolean; onDone(): void }> = ({ hasPassword, onDone }) => {
  const setPassword = useSetPassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready = next.length >= PASSWORD_MIN && next === confirm && (!hasPassword || current.length > 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready || setPassword.isPending) return;
    setError(null);
    setPassword.mutate(
      { newPassword: next, ...(hasPassword ? { currentPassword: current } : {}) },
      {
        onSuccess: () => {
          toast.success(hasPassword ? 'Password changed. Other devices were signed out.' : 'Password saved. You can now sign in with it.');
          onDone();
        },
        onError: (err) => setError(securityError(err)),
      },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-4 py-4" noValidate>
      {hasPassword ? (
        <PasswordInput label="Current password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      ) : null}
      <PasswordInput
        label={hasPassword ? 'New password' : 'Password'}
        autoComplete="new-password"
        helper={`At least ${PASSWORD_MIN} characters. A short phrase is easiest to remember.`}
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <PasswordInput
        label="Confirm password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={mismatch ? "The passwords don't match." : (error ?? undefined)}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={!ready} loading={setPassword.isPending}>
          {hasPassword ? 'Change password' : 'Save password'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

/** Dialog that asks for the current password before a sensitive change (two-step toggle, removing the password). */
const ConfirmWithPassword: FC<{
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  onConfirm(password: string): Promise<void>;
}> = ({ open, onOpenChange, title, description, confirmLabel, tone, onConfirm }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setPassword('');
          setError(null);
        }
      }}
      icon={tone === 'danger' ? Trash2 : ShieldCheck}
      tone={tone}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      confirmDisabled={password.length === 0}
      onConfirm={async () => {
        setError(null);
        try {
          await onConfirm(password);
          setPassword('');
        } catch (err) {
          setError(securityError(err));
          throw err;
        }
      }}
    >
      <PasswordInput
        label="Current password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (error) setError(null);
        }}
        error={error ?? undefined}
      />
    </Dialog>
  );
};

export const SecurityPage: FC = () => {
  const me = useMe();
  const security = useSecurity();
  const twoFactor = useSetTwoFactor();
  const remove = useRemovePassword();
  const [editing, setEditing] = useState(false);
  const [askTwoFactor, setAskTwoFactor] = useState<boolean | null>(null);
  const [askRemove, setAskRemove] = useState(false);
  useScreenView('settings_security');

  const s = security.data;

  return (
    <SettingsScreen title="Password & sign-in">
      <Group
        label="Email code"
        description="This always works, even if you set a password. It's also how you get back in if you forget your password."
      >
        <ListRow leading={<RowIcon icon={Mail} />} title="Sign in with a code" subtitle={`Sent to ${me.email}`} />
      </Group>

      {!s ? (
        security.isError ? (
          <div className="flex flex-col items-start gap-2 px-1">
            <p className="type-footnote text-danger">{errorMessage(security.error)}</p>
            <Button size="sm" variant="secondary" onClick={() => void security.refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <RowsSkeleton rows={2} />
        )
      ) : (
        <>
          <Group
            label="Password"
            description={
              s.hasPassword
                ? 'Changing your password signs you out everywhere else.'
                : 'Optional. Add one to sign in without waiting for an email.'
            }
          >
            <ListRow
              leading={<RowIcon icon={KeyRound} tone={s.hasPassword ? 'accent' : 'neutral'} />}
              title={s.hasPassword ? 'Password is set' : 'No password'}
              subtitle={s.hasPassword && s.passwordSetAt ? `Last changed ${formatDate(s.passwordSetAt)}` : 'You sign in with email codes'}
              trailing={
                editing ? null : (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                    {s.hasPassword ? 'Change' : 'Add password'}
                  </Button>
                )
              }
            />
            {editing ? <PasswordForm hasPassword={s.hasPassword} onDone={() => setEditing(false)} /> : null}
          </Group>

          <Group
            label="Two-step sign-in"
            description={
              s.hasPassword
                ? 'When this is on, signing in with your password also needs a code we email you. Someone who learns your password still can\'t get in.'
                : 'Add a password first. Two-step sign-in protects password sign-ins.'
            }
          >
            <ListRow
              leading={<RowIcon icon={ShieldCheck} tone={s.twoFactor ? 'accent' : 'neutral'} />}
              title={<span id="security-two-factor">Require an email code with my password</span>}
              subtitle={s.twoFactor ? 'On' : 'Off'}
              trailing={
                <Switch
                  checked={s.twoFactor}
                  disabled={!s.hasPassword || twoFactor.isPending}
                  onChange={(v) => setAskTwoFactor(v)}
                  aria-labelledby="security-two-factor"
                />
              }
            />
          </Group>

          {s.hasPassword ? (
            <Button variant="danger-ghost" size="lg" fullWidth leftIcon={Trash2} onClick={() => setAskRemove(true)}>
              Remove password
            </Button>
          ) : null}
        </>
      )}

      <ConfirmWithPassword
        open={askTwoFactor !== null}
        onOpenChange={(o) => {
          if (!o) setAskTwoFactor(null);
        }}
        title={askTwoFactor ? 'Turn on two-step sign-in?' : 'Turn off two-step sign-in?'}
        description={
          askTwoFactor
            ? 'From now on, signing in with your password also needs a code sent to your email.'
            : 'Your password alone will be enough to sign in again.'
        }
        confirmLabel={askTwoFactor ? 'Turn on' : 'Turn off'}
        onConfirm={async (currentPassword) => {
          const enabled = askTwoFactor ?? false;
          await twoFactor.mutateAsync({ enabled, currentPassword });
          toast.success(enabled ? 'Two-step sign-in is on.' : 'Two-step sign-in is off.');
        }}
      />

      <ConfirmWithPassword
        open={askRemove}
        onOpenChange={setAskRemove}
        tone="danger"
        title="Remove your password?"
        description="You'll sign in with email codes only. Two-step sign-in turns off too."
        confirmLabel="Remove password"
        onConfirm={async (currentPassword) => {
          await remove.mutateAsync({ currentPassword });
          setEditing(false);
          toast.info('Password removed. Sign in with email codes from now on.');
        }}
      />
    </SettingsScreen>
  );
};
