# Sample unstructured input (fictional)

This is a made-up example of the kind of input an SE would paste into the
`rhoai-sizing-intake` Cursor agent skill. No real customer is referenced —
"Meridian Trust Bank" is fictional.

---

> Hi team,
>
> Quick recap from today's call with Meridian Trust Bank. They're looking to
> stand up a production GenAI platform on-prem, data center only, connected
> via proxy, targeting OpenShift 4.21.
>
> Hardware: they already have 4x H100 SXM in a single server at the DC.
> For new capacity they're evaluating 16x H200 SXM across 2 servers.
>
> Three workloads came up:
> - A coding assistant for about 60-80 developers at once, long context
>   (~150K tokens), need responses within 8 seconds at 40+ tok/s. They're
>   leaning toward Qwen3.6-35B-A3B for this one.
> - A customer support chatbot, 200-800 concurrent customers, shorter
>   context (~8K in, 400 out), want it under 2.5s TTFT at 90 tok/s.
> - A compliance document reviewer, about 15 analysts, 4 hours/day,
>   15K token prompts (policy docs + case notes), 800 token summaries,
>   6 second TTFT is fine, no strict tok/s target given.
>
> They're planning for roughly 2x growth over 2 years. Guardrails came up
> briefly ("we're regulated so we'll need some kind of safety layer") but
> no specific RHOAI components were discussed yet.
>
> Thanks,
> SE team
