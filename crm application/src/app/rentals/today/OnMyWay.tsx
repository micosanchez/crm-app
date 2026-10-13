'use client';
import { useState } from 'react';
import { act } from '@/lib/rentals/client';

export default function OnMyWay({ rentalId }: { rentalId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'err'>('idle');
  return (<button className="btn-ghost" disabled={state === 'busy'} onClick={async () => { setState('busy'); try { await act('send_text', { rental_id: rentalId, template: 'on_my_way' }); setState('sent'); } catch { setState('err'); } }}>{state === 'sent' ? 'Sent ✓' : state === 'err' ? 'Failed' : state === 'busy' ? '…' : 'On my way'}</button>);
}
