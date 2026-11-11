// The + at the start of the message box: a small menu of what can go in a message besides words. Attaching a file, and
// the chat's commands, which it starts by putting a / in the box (the / menu then opens as if it had been typed).
import { Paperclip, Plus, SquareSlash } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { cn } from '@/lib/utils';

const ITEM = 'flex cursor-pointer select-none items-center gap-3 rounded-sm px-2.5 py-2 text-item outline-hidden data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-icon [&_svg]:shrink-0 [&_svg]:text-muted-foreground';

export function PlusMenu({ sheet, attach, slash }: { sheet?: boolean; attach?: () => void; slash: () => void }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger aria-label="Add to the message" className={cn('press grid shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground outline-hidden hover:bg-fill-2 hover:text-foreground focus-visible:bg-fill-2 focus-visible:text-foreground data-[state=open]:bg-fill-2 data-[state=open]:text-foreground', sheet ? 'mb-[3px] size-8' : 'mb-[5px] size-7')}>
        <Plus className="size-icon" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content data-chat-menu="" side="top" align="start" sideOffset={8} collisionPadding={12}
          // focus goes back to the message box, not to the +: whatever was picked is typed or attached there next
          onCloseAutoFocus={e => e.preventDefault()}
          className="z-50 min-w-[13rem] origin-(--radix-dropdown-menu-content-transform-origin) rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          {attach && <DropdownMenu.Item className={ITEM} onSelect={attach}><Paperclip />Add files or photos</DropdownMenu.Item>}
          <DropdownMenu.Item className={ITEM} onSelect={slash}><SquareSlash />Slash commands</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
