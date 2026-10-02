/**
 * Password field (DECISIONS D9): the kit `Input` with a show / hide toggle. Used by the password sign-in screen and
 * Settings → Password & sign-in. `autoComplete` must be `current-password` or `new-password` so password managers
 * offer the right thing.
 */
import { forwardRef, useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import { IconButton, Input, type InputProps } from '@/ui';

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'rightSlot' | 'autoComplete'> {
  autoComplete: 'current-password' | 'new-password';
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput({ leftIcon = KeyRound, ...rest }, ref) {
  const [shown, setShown] = useState(false);
  return (
    <Input
      ref={ref}
      {...rest}
      leftIcon={leftIcon}
      type={shown ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      rightSlot={
        <IconButton
          icon={shown ? EyeOff : Eye}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          size="sm"
          type="button"
          onClick={() => setShown((v) => !v)}
        />
      }
    />
  );
});
