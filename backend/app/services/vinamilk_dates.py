"""Inclusive date-range helpers for Vinamilk sync chunks."""

from datetime import date, timedelta


def iter_inclusive_dates(from_date: date, to_date: date):
    if to_date < from_date:
        raise ValueError("Ngày kết thúc phải lớn hơn hoặc bằng ngày bắt đầu.")
    current = from_date
    while current <= to_date:
        yield current
        current += timedelta(days=1)
