"""Predict IQ - In-process rate limiting for unauthenticated endpoints.

The public demo API is the only unauthenticated read surface in the product, so
it needs a cheap abuse guard. This is deliberately a small, dependency-free
sliding-window counter:

* keyed by client IP (the demo endpoints carry no identity by design);
* per-process only. A multi-worker deployment enforces the limit per worker,
  which bounds abuse without introducing a shared store (Redis and friends are
  an infrastructure decision, not a demo-feature decision);
* bounded memory: stale keys are pruned and the key map is capped.

The limiter never throws on construction; the endpoint dependency is the only
place a 429 is raised, so no other code path can be affected.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Deque, Dict, Tuple

# Hard cap on tracked client keys; beyond this the oldest bucket is dropped so a
# spoofed-source flood cannot grow memory without bound.
MAX_TRACKED_CLIENTS = 10_000


class SlidingWindowRateLimiter:
    """Allow at most ``max_requests`` per ``window_seconds`` per key."""

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max(1, int(max_requests))
        self.window_seconds = max(1, int(window_seconds))
        self._hits: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, now: float | None = None) -> Tuple[bool, int, int]:
        """Record a hit for ``key``.

        Returns ``(allowed, remaining, retry_after_seconds)``. ``retry_after`` is
        0 when the request is allowed.
        """
        timestamp = time.monotonic() if now is None else now
        cutoff = timestamp - self.window_seconds

        with self._lock:
            bucket = self._hits.get(key)
            if bucket is None:
                bucket = deque()
                self._hits[key] = bucket
                if len(self._hits) > MAX_TRACKED_CLIENTS:
                    self._prune_locked(cutoff)
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= self.max_requests:
                retry_after = max(1, int(self.window_seconds - (timestamp - bucket[0])) + 1)
                return False, 0, retry_after

            bucket.append(timestamp)
            return True, self.max_requests - len(bucket), 0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def _prune_locked(self, cutoff: float) -> None:
        """Drop empty/stale buckets. Caller must hold ``self._lock``."""
        stale = [key for key, bucket in self._hits.items() if not bucket or bucket[-1] <= cutoff]
        for key in stale:
            self._hits.pop(key, None)
        # Still over the cap (every key active): drop arbitrary oldest entries.
        while len(self._hits) > MAX_TRACKED_CLIENTS:
            self._hits.pop(next(iter(self._hits)))
