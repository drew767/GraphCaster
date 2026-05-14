# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool: current weather via Open-Meteo (no API key required)."""

from __future__ import annotations

from typing import Any


_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

_WMO_CONDITIONS: dict[int, str] = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Foggy",
    48: "Depositing rime fog",
    51: "Light drizzle",
    53: "Moderate drizzle",
    55: "Dense drizzle",
    61: "Slight rain",
    63: "Moderate rain",
    65: "Heavy rain",
    71: "Slight snow",
    73: "Moderate snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Slight rain showers",
    81: "Moderate rain showers",
    82: "Violent rain showers",
    85: "Slight snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm with slight hail",
    99: "Thunderstorm with heavy hail",
}


async def weather(
    location: str,
    *,
    units: str = "metric",
    _transport: Any = None,
) -> dict:
    """Return current weather for a location using Open-Meteo.

    location: City name or "lat,lon" string.
    units:    "metric" (°C, km/h) or "imperial" (°F, mph).

    Returns dict with keys: temperature, humidity, conditions, wind_speed,
    location, units, latitude, longitude.
    """
    import httpx

    client_kwargs: dict = {"timeout": 15.0, "follow_redirects": True}
    if _transport is not None:
        client_kwargs["transport"] = _transport

    async with httpx.AsyncClient(**client_kwargs) as client:
        lat, lon, resolved_name = await _resolve_location(client, location)
        data = await _fetch_weather(client, lat, lon, units)

    return {
        "location": resolved_name,
        "latitude": lat,
        "longitude": lon,
        "temperature": data["temperature"],
        "humidity": data["humidity"],
        "conditions": data["conditions"],
        "wind_speed": data["wind_speed"],
        "units": units,
    }


async def _resolve_location(
    client: Any, location: str
) -> tuple[float, float, str]:
    """Return (lat, lon, display_name) for the location string."""
    loc = location.strip()
    if "," in loc:
        parts = loc.split(",", 1)
        try:
            lat = float(parts[0].strip())
            lon = float(parts[1].strip())
            return lat, lon, loc
        except ValueError:
            pass

    resp = await client.get(
        _GEOCODE_URL,
        params={"name": loc, "count": "1", "format": "json"},
    )
    resp.raise_for_status()
    geo_data = resp.json()
    results = geo_data.get("results") or []
    if not results:
        raise ValueError(f"Location not found: {location!r}")
    result = results[0]
    lat = float(result["latitude"])
    lon = float(result["longitude"])
    name = result.get("name", location)
    country = result.get("country", "")
    display = f"{name}, {country}" if country else name
    return lat, lon, display


async def _fetch_weather(
    client: Any, lat: float, lon: float, units: str
) -> dict:
    """Fetch current weather from Open-Meteo forecast endpoint."""
    temp_unit = "fahrenheit" if units == "imperial" else "celsius"
    wind_unit = "mph" if units == "imperial" else "kmh"

    resp = await client.get(
        _FORECAST_URL,
        params={
            "latitude": str(lat),
            "longitude": str(lon),
            "current": "temperature_2m,relative_humidity_2m,weathercode,wind_speed_10m",
            "temperature_unit": temp_unit,
            "wind_speed_unit": wind_unit,
            "timezone": "auto",
            "forecast_days": "1",
        },
    )
    resp.raise_for_status()
    data = resp.json()

    current = data.get("current") or {}
    code = int(current.get("weathercode", 0) or 0)
    conditions = _WMO_CONDITIONS.get(code, f"Unknown (WMO {code})")

    return {
        "temperature": current.get("temperature_2m"),
        "humidity": current.get("relative_humidity_2m"),
        "wind_speed": current.get("wind_speed_10m"),
        "conditions": conditions,
    }
