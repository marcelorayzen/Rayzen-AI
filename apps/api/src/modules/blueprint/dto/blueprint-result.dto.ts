export interface BlueprintSuggestedEvent {
  intent: 'decision' | 'idea' | 'problem' | 'reference'
  content: string
}

export interface BlueprintPreviewResult {
  detectedSections: string[]
  suggestedWikiPages: string[]
  suggestedEvents: BlueprintSuggestedEvent[]
  suggestedNextSteps: string[]
  risks: string[]
}

export interface BlueprintImportResult {
  ok: boolean
  projectId: string
  created: {
    wikiPages: string[]
    documents: string[]
    events: string[]
    nextSteps: string[]
  }
  updated: {
    projectState: boolean
    brain: boolean
    planning: boolean
  }
  warnings: string[]
}
