# Automation Entry Points

Recommended workflow sequence:

1. `js-reverse_new_page` or `js-reverse_navigate_page` to open the page
2. `js-reverse_list_network_requests` to inspect recent requests
3. `js-reverse_get_request_initiator` to locate the call stack
4. `js-reverse_list_scripts` to define the script scope
5. `js-reverse_search_in_sources` to search for request paths, parameter names, or function names
6. If necessary, use `js-reverse_break_on_xhr` or `js-reverse_set_breakpoint_on_text`

By default, do not immediately start guessing how to mock `window`, `document`, or `navigator`.