# Key Points of Extension Analysis

| Field | Risk Signal |
|------|----------|
| host_permissions `<all_urls>` | Capable of reading and modifying arbitrary sites |
| webRequestBlocking | Man-in-the-middle (MitM) style modification |
| nativeMessaging | Escapes the browser to the local machine |
| externally_connectable | Extension can be invoked by web pages |

MV3: Focus on the service_worker lifecycle and declarativeNetRequest.