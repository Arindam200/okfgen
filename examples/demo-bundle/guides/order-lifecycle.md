---
type: Playbook
title: Order lifecycle
description: Explains how an order moves from creation to settlement.
tags: [operations, orders]
---

# States

1. The [Orders API](/api/orders.md) accepts the order.
2. Payment moves the order to `settled`.
3. Settled orders contribute to the [revenue metric](/metrics/revenue.md).
~