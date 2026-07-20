export default function SpiritMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M24 5C15 5 10 11.9 10 20.8c0 11 5.4 18.2 14 22.2 8.6-4 14-11.2 14-22.2C38 11.9 33 5 24 5Z"
        fill="currentColor"
      />
      <path d="M18 23.5h.01M30 23.5h.01" stroke="#f8f2e9" strokeWidth="4" strokeLinecap="round" />
      <path d="M19.5 30c2.7 2.7 6.3 2.7 9 0" stroke="#f8f2e9" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M24 5c0 5.1 3.1 8.1 8.2 8.1" stroke="#f8f2e9" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
