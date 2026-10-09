import { useId } from 'react'

/**
 * The Lineup Lab mark, drawn inline so it can never show as a broken image (it is
 * the same artwork as public/icon.svg, which the manifest and favicon use).
 */
export function LogoMark({ size = 28, radius = 15 }: { size?: number; radius?: number }) {
  const g = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00ceb8" />
          <stop offset="1" stopColor="#3f8cff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={radius} fill={`url(#${g})`} />
      <path d="M24.5 11.5h15" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
      <path
        d="M27.5 12v13.2L15.6 45.4a5 5 0 0 0 4.3 7.6h24.2a5 5 0 0 0 4.3-7.6L36.5 25.2V12"
        fill="none"
        stroke="#fff"
        strokeWidth="3.6"
        strokeLinejoin="round"
      />
      <rect x="21.5" y="34.2" width="21" height="4" rx="2" fill="#fff" />
      <rect x="19.2" y="40.6" width="25.6" height="4" rx="2" fill="#fff" fillOpacity=".8" />
      <rect x="18.6" y="47" width="26.8" height="2.6" rx="1.3" fill="#fff" fillOpacity=".55" />
    </svg>
  )
}
