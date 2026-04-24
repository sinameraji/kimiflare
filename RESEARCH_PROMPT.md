# Research Brief: Input Token Optimization for AI Coding Agents

## Background

We operate **kimiflare**, a terminal-based AI coding assistant powered by Kimi K2.6 via Cloudflare Workers AI. The tool follows a standard agent loop: user prompt → model generates tool calls → tools execute (read files, run bash, grep, etc.) → results fed back to model → repeat.

**Cost structure (Kimi K2.6 on Cloudflare):**
- Input: $0.95 / million tokens
- Cached input: $0.16 / million tokens (83% discount)
- Output: $4.00 / million tokens

**Current burn rate:** ~4.37M tokens/day → ~$24/day → ~$720/month.

While output tokens are 4× more expensive per token, **input volume dominates total cost** in long agent sessions because every tool result, file read, prior assistant message, and system prompt is fed back into the context window on each turn. A session with 50 turns can accumulate 200K+ input tokens while only generating ~100K output tokens.

**Current architecture:**
- Context window: 262K tokens
- System prompt: ~600–800 tokens (static per session, includes tool definitions + project context)
- Tool outputs capped at: bash/grep 30KB, web_fetch 100KB, read unlimited (2MB file max)
- Compaction: manual `/compact` command suggested at 80% context usage; summarizes old turns
- Reasoning tokens: model emits `reasoning_content` which is stored in history and resent as input
- No prompt caching implemented
- No truncation of historical tool results beyond manual compaction

## Research Objective

Identify, evaluate, and prioritize **input token reduction strategies** for an AI coding agent that preserve (or improve) task completion quality. Focus on techniques that reduce the volume of text sent to the API on each turn, not on switching to cheaper models or reducing output length.

## Research Questions

### 1. Prompt Caching
- Does Cloudflare Workers AI support prompt caching for the system message? If so, what API parameters or headers are required?
- What is the hit rate behavior? Is the cache keyed by the full messages array or just the system prompt?
- Are there providers (OpenAI, Anthropic, Google) with more mature prompt caching that we should benchmark against?
- What is the typical latency impact of cache misses vs hits?

### 2. Conversation History Compression
- What are state-of-the-art methods for compressing multi-turn agent conversation history beyond naive summarization?
- How do techniques like **Hierarchical Summarization**, **Memory Networks**, **Key-Value Memory**, or **Embedding-based Retrieval** compare for coding tasks?
- Can we selectively retain full content for "important" turns (e.g., where files were modified) while summarizing "noisy" turns (e.g., failed grep attempts)?
- What is the optimal compaction frequency? Should it be time-based, token-count-based, or task-boundary-based?

### 3. Tool Output Truncation & Filtering
- What is the optimal cap for each tool type that balances information density vs token cost?
  - `read`: currently unlimited lines; should we cap at N lines with a "...truncated" note?
  - `bash`: currently 30KB; what is the marginal utility of output beyond 10KB for coding tasks?
  - `grep`: currently 30KB; is `files` mode (just paths) sufficient for initial exploration?
  - `web_fetch`: currently 100KB; can we extract just the relevant section?
- Can we apply **semantic filtering** (e.g., extract only error lines from test output, only function signatures from docs)?
- What is the impact of truncation on the model's ability to debug? Are there task categories where full output is essential?

### 4. Selective History Inclusion
- Do we need to include the full content of prior assistant messages (especially `reasoning_content`) in subsequent turns?
- Can we replace old tool results with a one-line summary ("read `src/app.tsx` — found context limit logic") once the model has acted on them?
- What is the impact of dropping image content from history after the turn where it was referenced?
- Can we maintain a "working memory" of only the last N turns + a compressed archive of older turns?

### 5. System Prompt Optimization
- How much do tool descriptions contribute to the system prompt token count? Can we shorten them without hurting tool selection accuracy?
- Can we dynamically include/exclude tool definitions based on the current task (e.g., don't describe `web_fetch` if the user is only editing local files)?
- What is the impact of removing the `KIMI.md` project context from the system prompt and instead injecting it only when relevant?

### 6. Structured vs Unstructured Tool Results
- Does formatting tool results as structured data (JSON, XML) vs plain text impact token efficiency?
- Can we use a more compact representation (e.g., line-numbered code blocks without full paths repeated)?

### 7. Benchmarking & Evaluation
- Propose a benchmark suite of 10–20 representative coding tasks (debugging, refactoring, exploration, testing) that can be run headlessly.
- How should we measure "quality preservation"? (task completion rate, correctness of edits, number of turns to completion, user satisfaction proxy)
- What is the expected token savings vs quality trade-off for each technique?

## Deliverables

1. **Literature Review** (2–3 pages): Survey of existing techniques for context compression in LLM agents, with citations. Focus on coding/agent applications, not general LLM inference optimization.

2. **Provider Analysis** (1 page): Matrix of prompt caching support across major providers (Cloudflare, OpenAI, Anthropic, Google, AWS Bedrock) with pricing and implementation notes.

3. **Prioritized Recommendations** (ranked list):
   - For each technique: estimated token savings (%), implementation complexity (hours), quality risk (low/medium/high), and recommended experiment design.
   - Clear "do first" / "do next" / "investigate later" buckets.

4. **Experiment Protocol**: A concrete plan for A/B testing the top 3 recommendations using the existing kimiflare codebase as the test environment. Include:
   - How to measure input tokens per session
   - How to measure task success
   - Minimum sample size per variant

5. **Prototype Code** (optional but preferred): A branch or patch demonstrating the highest-ROI technique (likely reasoning_content stripping + tool output caps).

## Constraints

- **Model lock:** We are committed to Kimi K2.6 for the foreseeable future. Do not research model switching.
- **Quality floor:** Any optimization must not reduce the agent's ability to complete multi-file refactoring, debugging with stack traces, or codebase exploration tasks.
- **Latency ceiling:** Techniques that add >500ms per turn are likely unacceptable unless the token savings are massive (>30%).
- **Open source:** Prefer techniques that don't require proprietary infrastructure. We can run small local models for filtering/summarization if needed.

## Success Metrics

The research is successful if we can identify a combination of techniques that together reduce **input tokens per session by 30–50%** with **<5% regression in task completion rate**.

---

**Timeline:** 1 week for initial findings, 2 weeks for prototype + benchmark results.

**Point of contact:** [Your name] — available for daily standups and code walkthroughs of the kimiflare agent loop.
