from datetime import datetime, timedelta, timezone
from statistics import median


def day_counts(weeks):
    counts = {}
    for week in weeks:
        if not isinstance(week, dict):
            raise ValueError("Invalid star history week")
        timestamp, days = week.get("week"), week.get("days")
        if type(timestamp) is not int or not isinstance(days, list) or len(days) != 7:
            raise ValueError("Invalid star history week")
        try:
            start = datetime.fromtimestamp(timestamp, timezone.utc).date()
        except (OverflowError, OSError) as error:
            raise ValueError("Invalid star history timestamp") from error

        for offset, stars in enumerate(days):
            if stars is None:
                continue
            if type(stars) is not int or stars < 0:
                raise ValueError("Invalid star count")
            day = start + timedelta(days=offset)
            if day in counts:
                raise ValueError("Overlapping star history weeks")
            counts[day] = stars
    return counts


def analyze_stars(weeks, created, as_of):
    counts = day_counts(weeks)
    if created is None:
        # Without the creation date we cannot identify zeroes that predate the repository.
        return [], {"status": "unavailable"}

    counts = {day: value for day, value in counts.items() if created <= day <= as_of}
    window = [as_of - timedelta(days=offset) for offset in reversed(range(14))]
    history = [
        {"date": day.isoformat(), "stars": counts.get(day)}
        for day in window if day >= created
    ]
    comparable = False
    for day in reversed(window):
        value = counts.get(day)
        prior = [counts.get(day - timedelta(days=offset)) for offset in range(1, 8)]
        if value is None or any(count is None for count in prior):
            continue
        comparable = True
        baseline = median(prior)
        if value >= 100 and value >= 5 * baseline:
            return history, {
                "status": "found", "date": day.isoformat(), "stars": value, "baseline": baseline,
            }
    return history, {"status": "no_spike" if comparable else "insufficient"}
