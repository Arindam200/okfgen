---
type: API Endpoint
title: Orders API
description: Creates and retrieves customer orders.
tags: [api, commerce]
---

# Endpoints

`POST /orders` creates an order. The resulting state transitions are described in the [order lifecycle](/guides/order-lifecycle.md).

# Examples

```json
{ "customer_id": "cus_123", "total_usd": 84.50 }
```
