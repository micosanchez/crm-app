'use client';
import { useEffect, useState } from 'react';

/** The app sign-in URL, with a copy button, to share with new team members. */
export default function TeamAccessLink() {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => { setUrl(window.location.origin); }, []);

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Team sign-in link</p>
        <p className="mt-0.5 font-medium">{url || '…'}</p>
        <p className="text-xs text-gray-500">Send this to a new member along with their email + temporary password.</p>
      </div>
      <button
        className="btn-ghost"
        onClick={() => { if (url) { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
      >
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </div>
  );
}
