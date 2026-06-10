import type { Prompt } from '../api/types';
import { usePromptGraduation } from '../api/hooks';
import { useToast } from './Toast';

const GRADUATION_STREAK = 3;

/**
 * A topic's prompts (the recall questions used by ReviewGate): each shows its
 * progress toward automatic graduation, or a graduated badge with a manual
 * un-graduate toggle once retired from rotation.
 */
export function PromptsPanel({ topicId, prompts }: { topicId: string; prompts: Prompt[] }) {
  const setGraduated = usePromptGraduation(topicId);
  const { toast } = useToast();

  const toggle = (id: string, graduated: boolean) => {
    setGraduated.mutate(
      { id, graduated },
      {
        onSuccess: () => toast(graduated ? 'Prompt graduated' : 'Prompt un-graduated', 'success'),
        onError: (e) => toast(e instanceof Error ? e.message : 'Could not update prompt', 'error'),
      },
    );
  };

  return (
    <div className="card card-pad col gap-3">
      <div className="card-title" style={{ margin: 0 }}>
        Prompts ({prompts.length})
      </div>

      {prompts.length === 0 ? (
        <span className="faint">No prompts yet for this topic.</span>
      ) : (
        <div className="col gap-2">
          {prompts.map((p) => (
            <div key={p.id} className="row gap-2" style={{ alignItems: 'center' }}>
              <span className="grow">{p.promptText}</span>
              {p.graduated ? (
                <>
                  <span className="pill nowrap">🎓 Graduated</span>
                  <button
                    className="btn btn-sm"
                    disabled={setGraduated.isPending}
                    onClick={() => toggle(p.id, false)}
                  >
                    Un-graduate
                  </button>
                </>
              ) : (
                <span className="faint nowrap" style={{ fontSize: 12 }}>
                  {p.consecutiveGood}/{GRADUATION_STREAK}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
