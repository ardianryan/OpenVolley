interface VolleyballIconProps {
  className?: string;
}

export function VolleyballIcon({ className = 'h-4 w-4' }: VolleyballIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      {/* Classic 3-way curved volleyball tri-seams */}
      <path d="M12 12C10.5 7.5 7.2 4.2 3.2 3.5" />
      <path d="M12 12C16.5 11.2 20 13.5 21.5 17" />
      <path d="M12 12C9.8 16.2 6.2 19 2.5 19.5" />
      {/* Inner panel seams */}
      <path d="M14.2 8.8C12.5 5.2 9.5 2.8 6.2 2.2" />
      <path d="M13 8.2C17.2 7.8 20.5 10 21.9 13.2" />
      <path d="M15.2 13.5C13.2 17.5 9.8 20.2 5.8 21.4" />
    </svg>
  );
}
