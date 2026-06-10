import SignClient from './SignClient';

export const dynamic = 'force-dynamic';

/** Public customer-facing page: /sign/estimate/<token> or /sign/invoice/<token>. No login required. */
export default function SignPage({ params }: { params: { kind: string; token: string } }) {
  const kind = params.kind === 'invoice' ? 'invoice' : 'estimate';
  return <SignClient kind={kind} token={params.token} />;
}
