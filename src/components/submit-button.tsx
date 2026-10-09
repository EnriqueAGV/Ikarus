"use client";

import { useFormStatus } from "react-dom";

// A submit button that locks while its form is being sent, so a double click
// cannot send the form twice.
export function SubmitButton({
  pendingText,
  className,
  children,
}: {
  pendingText: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}
