import { useMemo, useState } from "react";
import {
  FUNNEL_STAGE_LABELS,
  STAGE_TOPICS,
  TOPIC_LABELS,
  type FunnelStage,
  type TaxonomyTopic,
} from "../../types/taxonomy";

function buildTopicOptions(selectedStages: FunnelStage[]) {
  const stages =
    selectedStages.length > 0
      ? selectedStages
      : (Object.keys(STAGE_TOPICS) as FunnelStage[]);

  return stages.flatMap((stage) =>
    STAGE_TOPICS[stage].map((topic) => ({
      value: topic,
      label: TOPIC_LABELS[topic],
      group: FUNNEL_STAGE_LABELS[stage],
    }))
  );
}

export function useQuoteSelection(initial?: {
  selectedStages?: FunnelStage[];
  selectedTopics?: TaxonomyTopic[];
}) {
  const [selectedStages, setSelectedStages] = useState<FunnelStage[]>(
    initial?.selectedStages ?? []
  );
  const [selectedTopics, setSelectedTopics] = useState<TaxonomyTopic[]>(
    initial?.selectedTopics ?? []
  );

  const topicOptions = useMemo(
    () => buildTopicOptions(selectedStages),
    [selectedStages]
  );

  const handleStagesChange = (stages: string[]) => {
    const nextStages = stages as FunnelStage[];
    setSelectedStages(nextStages);

    if (nextStages.length > 0) {
      const validTopics = new Set(nextStages.flatMap((stage) => STAGE_TOPICS[stage]));
      setSelectedTopics((prev) => prev.filter((topic) => validTopics.has(topic)));
    }
  };

  return {
    selectedStages,
    selectedTopics,
    topicOptions,
    setSelectedStages,
    setSelectedTopics,
    handleStagesChange,
  };
}
