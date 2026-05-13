import { nanoid } from 'nanoid';
import { config } from '@/lib/config';
import ChatWindow from '@/components/ChatWindow';
import DemoBanner from '@/components/DemoBanner';

export const dynamic = 'force-dynamic';

export default function Home() {
  const initialSessionId = nanoid();

  return (
    <main className="flex flex-col h-screen">
      <DemoBanner
        company={config.demoCustomer.company}
        contact={config.demoCustomer.contact}
      />
      <ChatWindow
        initialSessionId={initialSessionId}
        stages={config.stages as unknown as Array<{ id: string; label: string }>}
        customerCompany={config.demoCustomer.company}
      />
    </main>
  );
}
