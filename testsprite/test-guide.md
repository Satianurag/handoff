# Test guide

- Start every test at `/demo` in a fresh browser context. Demo auth is stored in `sessionStorage`, so deep links must retain `?sample=1`.
- To test the second role, use **Sample controls → Open recipient role**. Its `/demo/join` link is one-use.
- Never use the email sign-in flow.
- Never upload real personal data; use fictional sample content only.
