import { StateGraph, END } from '@langchain/langgraph';
import { GraphState } from './state';
import { supervisorAgent, routeAfterSupervisor } from '../agents/supervisor';
import { questionerAgent } from '../agents/questioner';
import { webResearcherAgent } from '../agents/webResearcher';
import { safetyCheckerAgent } from '../agents/safetyChecker';
import { recommenderAgent } from '../agents/recommender';
import { productFinderAgent } from '../agents/productFinder';

/**
 * Builds and compiles the LangGraph workflow.
 *
 * Graph topology:
 *   START → supervisor
 *   supervisor ──(conditional)──▶ interview | catalog_search | web_search | safety_check | recommend | END
 *   interview   ──────────────▶ supervisor
 *   catalog_search ────────────▶ supervisor
 *   web_search    ──────────────▶ supervisor
 *   safety_check ─────────────▶ supervisor
 *   recommend   ──────────────▶ END
 */
export function buildWorkflow() {
  const workflow = new StateGraph(GraphState)
    .addNode('supervisor',    supervisorAgent)
    .addNode('interview',     questionerAgent)
    .addNode('catalog_search', productFinderAgent)
    .addNode('web_search',    webResearcherAgent)
    .addNode('safety_check',  safetyCheckerAgent)
    .addNode('recommend',     recommenderAgent);

  workflow.setEntryPoint('supervisor');

  workflow.addConditionalEdges('supervisor', routeAfterSupervisor, {
    interview:      'interview',
    catalog_search: 'catalog_search',
    web_search:     'web_search',
    safety_check:   'safety_check',
    recommend:      'recommend',
    done:           END,
    error:          END,
  });

  workflow.addEdge('interview',    'supervisor');
  workflow.addEdge('catalog_search', 'supervisor');
  workflow.addEdge('web_search',    'supervisor');
  workflow.addEdge('safety_check', 'supervisor');
  workflow.addEdge('recommend',     END);

  return workflow.compile();
}

export const graph = buildWorkflow();
