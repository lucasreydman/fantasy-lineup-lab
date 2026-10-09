import { useDockTarget } from '../lib/touchDrag'
import type { Team } from '../lib/types'
import { TeamAvatar } from './ui'

/**
 * On phones the two rosters are stacked, so the other team is a long way from your
 * finger. While anything is being dragged, this bar pins both teams to the bottom
 * of the screen as big drop targets.
 */
export function DropDock({ me, partner }: { me: Team; partner: Team }) {
  return (
    <div className="drop-dock safe-bottom fixed inset-x-0 bottom-0 z-40 gap-2 border-t border-line bg-bg/95 px-3 pt-3 pb-3 backdrop-blur">
      <Zone side="me" team={me} label="You" />
      <Zone side="partner" team={partner} label="Trade partner" />
    </div>
  )
}

function Zone({ side, team, label }: { side: string; team: Team; label: string }) {
  const { over, bind } = useDockTarget(side)
  return (
    <div
      {...bind}
      className={`dock-zone flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl border-2 border-dashed px-3 py-3 transition ${
        over ? 'scale-[1.03] border-solid border-teal bg-teal/20' : 'border-teal/50 bg-panel'
      }`}
    >
      <TeamAvatar url={team.avatarUrl} name={team.name} size={32} />
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-teal">{label}</div>
        <div className="truncate text-[13px] font-semibold">{team.name}</div>
      </div>
    </div>
  )
}
