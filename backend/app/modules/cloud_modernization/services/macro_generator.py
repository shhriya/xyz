"""Macro Generator — 7 reusable Jinja2 macros for Snowflake dbt projects."""
from typing import Dict


def generate_all_macros() -> Dict[str, str]:
    macros: Dict[str, str] = {}

    macros["macros/generate_surrogate_key.sql"] = (
        "{%- macro generate_surrogate_key(field_list) -%}\n"
        "    {#- MD5 surrogate key from a list of field names. Snowflake compatible. -#}\n"
        "    {#- Usage: {{ generate_surrogate_key(['customer_id', 'order_id']) }} -#}\n"
        "    md5(\n"
        "        concat_ws(\n"
        "            '-',\n"
        "            {%- for field in field_list %}\n"
        "                coalesce(cast({{ field }} as varchar), '##NULL##')\n"
        "                {%- if not loop.last %}, {% endif %}\n"
        "            {%- endfor %}\n"
        "        )\n"
        "    )\n"
        "{%- endmacro -%}\n"
    )

    macros["macros/safe_divide.sql"] = (
        "{%- macro safe_divide(numerator, denominator) -%}\n"
        "    {#- Safe division — returns null instead of dividing by zero. -#}\n"
        "    {#- Usage: {{ safe_divide('revenue', 'orders') }} -#}\n"
        "    iff(\n"
        "        ({{ denominator }}) = 0 or ({{ denominator }}) is null,\n"
        "        null,\n"
        "        ({{ numerator }}) / ({{ denominator }})\n"
        "    )\n"
        "{%- endmacro -%}\n"
    )

    macros["macros/audit_columns.sql"] = (
        "{%- macro audit_columns() -%}\n"
        "    {#- Standard audit columns for Gold layer models. -#}\n"
        "    {#- Usage: {{ audit_columns() }} -#}\n"
        "    current_timestamp()   as _loaded_at,\n"
        "    '{{ invocation_id }}' as _dbt_run_id,\n"
        "    '{{ this.name }}'     as _model_name\n"
        "{%- endmacro -%}\n"
    )

    macros["macros/calculate_gst.sql"] = (
        "{%- macro calculate_gst(amount_col, gst_rate_col='gst_rate', default_rate=0.18) -%}\n"
        "    {#- Calculates GST amount from a base amount and rate. -#}\n"
        "    {#- Usage: {{ calculate_gst('unit_price') }} -#}\n"
        "    round(\n"
        "        {{ amount_col }} * coalesce({{ gst_rate_col }}, {{ default_rate }}),\n"
        "        2\n"
        "    )\n"
        "{%- endmacro -%}\n"
    )

    macros["macros/fiscal_calendar.sql"] = (
        "{%- macro get_fiscal_year(date_col) -%}\n"
        "    {#- Indian fiscal year (April-March). e.g. 2024-05-01 -> FY2024-25 -#}\n"
        "    {#- Usage: {{ get_fiscal_year('order_date') }} -#}\n"
        "    'FY' || iff(month({{ date_col }}) >= 4, year({{ date_col }}), year({{ date_col }})-1)\n"
        "         || '-' || right(iff(month({{ date_col }}) >= 4, year({{ date_col }})+1, year({{ date_col }}))::varchar, 2)\n"
        "{%- endmacro -%}\n\n"
        "{%- macro get_fiscal_quarter(date_col) -%}\n"
        "    {#- Indian fiscal quarter. Q1:Apr-Jun Q2:Jul-Sep Q3:Oct-Dec Q4:Jan-Mar -#}\n"
        "    case\n"
        "        when month({{ date_col }}) in (4,5,6)    then 'Q1'\n"
        "        when month({{ date_col }}) in (7,8,9)    then 'Q2'\n"
        "        when month({{ date_col }}) in (10,11,12) then 'Q3'\n"
        "        else 'Q4'\n"
        "    end\n"
        "{%- endmacro -%}\n"
    )

    macros["macros/currency_formatter.sql"] = (
        "{%- macro format_inr(amount_col, decimal_places=2) -%}\n"
        "    {#- Formats a numeric amount as Indian Rupee string. -#}\n"
        "    {#- Usage: {{ format_inr('revenue') }} -#}\n"
        "    '₹' || to_varchar(round({{ amount_col }}, {{ decimal_places }}), '999,999,999.00')\n"
        "{%- endmacro -%}\n"
    )

    macros["macros/incremental_filter.sql"] = (
        "{%- macro incremental_filter(timestamp_col, lookback_days=3) -%}\n"
        "    {#- Standard incremental filter with lookback window for late-arriving data. -#}\n"
        "    {#- Usage: where {{ incremental_filter('order_timestamp') }} -#}\n"
        "    {%- if is_incremental() -%}\n"
        "        {{ timestamp_col }} >= dateadd(\n"
        "            'day',\n"
        "            -{{ lookback_days }},\n"
        "            (select max({{ timestamp_col }}) from {{ this }})\n"
        "        )\n"
        "    {%- else -%}\n"
        "        1 = 1\n"
        "    {%- endif -%}\n"
        "{%- endmacro -%}\n"
    )

    return macros
