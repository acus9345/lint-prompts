Summarize the document below in {{ max_words }} words or fewer.

{% for doc in documents %}
<document title="{{ doc.title }}">
{{ doc.body }}
</document>
{% endfor %}
